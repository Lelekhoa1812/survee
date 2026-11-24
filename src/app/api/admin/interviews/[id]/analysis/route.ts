import { ANALYTICS_STATUSES } from "@/lib/analytics/cohorts";
import { answerCrossTabError, answerSegmentationError, canCrossTabByAnswer, canSegmentByAnswer, summarizeAnswerCrossTab, summarizeAnswerSegments } from "@/lib/analytics/segments";
import { withCurrentEligibility } from "@/lib/analytics/summary";
import { suppressSmallCohortAnalytics } from "@/lib/analytics/disclosure";
import { eligibilityQuestionIds } from "@/lib/format/answers";
import { adminSession, fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { getInterview, getVersion, iterateAnalyticsParticipants } from "@/lib/repo";
import { getWorkspaceAnalytics } from "@/lib/repo/workspace-analytics";
import type { ParticipantStatus } from "@/lib/repo/types";

/** Return aggregate-only answer segments for up to 20 selected outcome questions in one scan. */
export const GET = withServerErrors("admin/interviews/[id]/analysis", async function GET(req: Request, ctx: RouteContext<"/api/admin/interviews/[id]/analysis">) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const requestedVersion = url.searchParams.get("surveyVersion");
  if (!requestedVersion || !/^\d+$/.test(requestedVersion) || !Number.isSafeInteger(Number(requestedVersion)) || Number(requestedVersion) < 1) {
    return fail(400, "Choose the survey version shown on the analysis page.");
  }
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const session = await adminSession();
  const workspaceAnalytics = await getWorkspaceAnalytics(session?.tenantId ?? "");
  const minimumCellSize = workspaceAnalytics?.analyticsMinimumCellSize ?? 5;
  if (interview.currentVersion !== Number(requestedVersion)) {
    return fail(409, "This survey changed while the page was open. Reload the interview to view analysis for the latest version.");
  }
  const version = await getVersion(interview._id, interview.currentVersion);
  if (!version) return fail(404, "Survey version not found.");
  const staleScanResponse = async () => {
    const current = await getInterview(id);
    return current
      && current.currentVersion === interview.currentVersion
      && (current.respondentWriteRevision ?? 0) === (interview.respondentWriteRevision ?? 0)
      ? null
      : fail(409, "Answers changed while this analysis was running. Retry the analysis to get a consistent result.");
  };

  const segmentById = (url.searchParams.get("segmentBy") ?? "").trim();
  const crossTabWithIds = url.searchParams.getAll("crossTabWith").map((id) => id.trim());
  if (crossTabWithIds.length) {
    if (crossTabWithIds.length !== 1 || !crossTabWithIds[0]) return fail(400, "Choose exactly one second question for the cross-tab.");
    if (!segmentById) return fail(400, "Choose two questions for the cross-tab.");
    if (url.searchParams.has("questionId")) return fail(400, "Cross-tabs compare two questions; remove outcome questions.");
    const rowQuestion = version.manifest.questions.find((question) => question.id === segmentById);
    const columnQuestion = version.manifest.questions.find((question) => question.id === crossTabWithIds[0]);
    if (!rowQuestion || !columnQuestion) return fail(404, "A cross-tab question was not found in the current survey version.");
    if (!canCrossTabByAnswer(rowQuestion, columnQuestion)) return fail(400, answerCrossTabError(rowQuestion, columnQuestion));
    const requested = (url.searchParams.get("statuses") ?? ANALYTICS_STATUSES.join(",")).split(",").map((status) => status.trim());
    if (!requested.length || requested.some((status) => !ANALYTICS_STATUSES.includes(status as ParticipantStatus))) {
      return fail(400, "Choose one or more supported participant statuses.");
    }
    const statuses = ANALYTICS_STATUSES.filter((status) => requested.includes(status)) as ParticipantStatus[];
    if (!statuses.length) return fail(400, "Choose one or more supported participant statuses.");
    const analysis = await summarizeAnswerCrossTab(
      rowQuestion,
      columnQuestion,
      withCurrentEligibility(version.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(version.manifest, [rowQuestion.id, columnQuestion.id]), { statuses })),
      statuses,
    );
    const stale = await staleScanResponse();
    if (stale) return stale;
    const result = {
      ok: true,
      interviewId: id,
      surveyVersion: version.version,
      asOf: analysis.asOf,
      rowBy: { id: rowQuestion.id, type: rowQuestion.type, label: rowQuestion.label },
      columnBy: { id: columnQuestion.id, type: columnQuestion.type, label: columnQuestion.label },
      scope: { statuses, participantCount: analysis.participantCount },
      rows: analysis.rows.map(({ statusCounts: _statusCounts, ...row }) => row),
      columns: analysis.columns.map(({ statusCounts: _statusCounts, ...column }) => column),
      cells: analysis.cells.map(({ statusCounts: _statusCounts, disclosureRisk, ...cell }) => ({
        ...cell,
        disclosureRisk: { singletonSegment: disclosureRisk.singletonSegment, singletonStatusGroups: [] },
      })),
      overlapping: analysis.overlapping,
      methodology: [
        "The cross-tab uses two closed categorical questions from the current survey version and only the participant statuses shown in scope. It is computed from one projected live scan; if the survey version or respondent data revision changes during the scan, the request is rejected and can be retried. MongoDB snapshot isolation is not used.",
        "Each cell counts distinct people for that answer pair. Row percentages use the row's participant count as denominator. If either question is a checkbox, people can appear in multiple rows or columns and cell counts and percentages can overlap or sum above 100%.",
        "Inactive by current rules is a separate dimension group. Eligibility is inferred from current rules and saved answers, not historical display. No stored answer includes blank and note-only responses among eligible people. Invalid stored values appear as Unmapped answer.",
        `The workspace minimum cell size is ${minimumCellSize}; if a reported cell, margin, denominator, or derived count is below it, the complete aggregate result is withheld. Non-comparison results omit per-status counts. Zero cells remain visible. This reduces small-group disclosure but does not guarantee anonymity or prevent differencing across repeated queries.`,
      ],
    };
    const disclosure = suppressSmallCohortAnalytics(result, minimumCellSize);
    return json(disclosure.suppressed
      ? { ok: true, suppressed: true, minimumCellSize: disclosure.minimumCellSize, reason: disclosure.reason, interviewId: id, surveyVersion: version.version, asOf: analysis.asOf, rowBy: { id: rowQuestion.id, type: rowQuestion.type, label: rowQuestion.label }, columnBy: { id: columnQuestion.id, type: columnQuestion.type, label: columnQuestion.label }, scope: { statuses }, rows: [], columns: [], cells: [], overlapping: analysis.overlapping, methodology: [] }
      : { ...disclosure.value, disclosureControl: { minimumCellSize: disclosure.minimumCellSize, suppressed: false } });
  }
  const outcomeIds = url.searchParams.getAll("questionId").map((id) => id.trim());
  if (!segmentById || !outcomeIds.length || outcomeIds.some((id) => !id)) return fail(400, "Choose a segmentation question and one or more outcome questions.");
  if (outcomeIds.length > 20) return fail(400, "Choose no more than 20 outcome questions for one analysis read.");
  if (new Set(outcomeIds).size !== outcomeIds.length) return fail(400, "Choose each outcome question only once.");
  const segmentQuestion = version.manifest.questions.find((question) => question.id === segmentById);
  const outcomes = outcomeIds.map((outcomeId) => version.manifest.questions.find((question) => question.id === outcomeId));
  if (!segmentQuestion) return fail(404, "Segmentation question not found in the current survey version.");
  if (outcomes.some((question) => !question)) return fail(404, "An outcome question was not found in the current survey version.");
  if (outcomeIds.includes(segmentQuestion.id)) return fail(400, "Choose outcome questions other than the segmentation question.");
  if (!canSegmentByAnswer(segmentQuestion)) return fail(400, answerSegmentationError(segmentQuestion));

  const requested = (url.searchParams.get("statuses") ?? ANALYTICS_STATUSES.join(",")).split(",").map((status) => status.trim());
  if (!requested.length || requested.some((status) => !ANALYTICS_STATUSES.includes(status as ParticipantStatus))) {
    return fail(400, "Choose one or more supported participant statuses.");
  }
  const statuses = ANALYTICS_STATUSES.filter((status) => requested.includes(status)) as ParticipantStatus[];
  if (!statuses.length) return fail(400, "Choose one or more supported participant statuses.");
  const compareStatuses = url.searchParams.get("compareStatuses") === "true";
  const selectedOutcomes = outcomes as NonNullable<(typeof outcomes)[number]>[];
  const analysis = await summarizeAnswerSegments(
    segmentQuestion,
    selectedOutcomes,
    withCurrentEligibility(version.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(version.manifest, [segmentQuestion.id, ...selectedOutcomes.map((question) => question.id)]), { statuses })),
    statuses,
    compareStatuses,
  );
  const stale = await staleScanResponse();
  if (stale) return stale;
  const participantCount = statuses.reduce((count, status) => count + analysis.statusCounts[status], 0);
  const result = {
    ok: true,
    interviewId: id,
    surveyVersion: version.version,
    asOf: analysis.asOf,
    segmentBy: { id: segmentQuestion.id, type: segmentQuestion.type, label: segmentQuestion.label },
    outcomes: selectedOutcomes.map((question) => ({ id: question.id, type: question.type, label: question.label })),
    ...(selectedOutcomes.length === 1 ? { outcome: { id: selectedOutcomes[0].id, type: selectedOutcomes[0].type, label: selectedOutcomes[0].label } } : {}),
    scope: { statuses, participantCount, ...(compareStatuses ? { statusCounts: analysis.statusCounts } : {}), compareStatuses },
    segments: compareStatuses ? analysis.segments : analysis.segments.map(({ statusCounts: _statusCounts, disclosureRisk, ...segment }) => ({
      ...segment,
      disclosureRisk: { ...disclosureRisk, singletonStatusGroups: [] },
    })),
    methodology: [
      "Answer segments use the selected current-version question and only the participant statuses shown in scope. All selected outcome summaries exclude the segmentation question and use the same projected participant scan and asOf; if the survey version or respondent data revision changes during the scan, the request is rejected and can be retried. MongoDB snapshot isolation is not used.",
      "Single-choice, dropdown, and scale answers place each person in one answer segment. Checkbox answers can place one person in several option segments; those segment counts and percentages overlap and must not be added together.",
      "Inactive by current rules is a separate dimension group. Eligibility is inferred from current rules and saved answers, not historical display. No stored answer includes blank and note-only dimension responses among eligible people. Invalid stored dimension values appear as Unmapped answer.",
      `The workspace minimum cell size is ${minimumCellSize}; if a reported cell, margin, denominator, or derived count is below it, the complete aggregate result is withheld. Non-comparison results omit per-status counts. Zero cells remain visible. This reduces small-group disclosure but does not guarantee anonymity or prevent differencing across repeated queries.`,
      ...(compareStatuses ? ["Status summaries for all selected answer segments share this asOf and one participant scan; revision changes during the live read cause the request to be rejected."] : []),
    ],
  };
  const disclosure = suppressSmallCohortAnalytics(result, minimumCellSize);
  return json(disclosure.suppressed
    ? { ok: true, suppressed: true, minimumCellSize: disclosure.minimumCellSize, reason: disclosure.reason, interviewId: id, surveyVersion: version.version, asOf: analysis.asOf, segmentBy: { id: segmentQuestion.id, type: segmentQuestion.type, label: segmentQuestion.label }, outcomes: selectedOutcomes.map((question) => ({ id: question.id, type: question.type, label: question.label })), scope: { statuses, compareStatuses }, segments: [], methodology: [] }
    : { ...disclosure.value, disclosureControl: { minimumCellSize: disclosure.minimumCellSize, suppressed: false } });
});
