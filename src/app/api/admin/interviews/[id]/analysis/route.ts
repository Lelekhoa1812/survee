import { ANALYTICS_STATUSES } from "@/lib/analytics/cohorts";
import { canSegmentByAnswer, summarizeAnswerSegments } from "@/lib/analytics/segments";
import { fail, guardAdmin, json } from "@/lib/http";
import { getInterview, getVersion, iterateAnalyticsParticipants } from "@/lib/repo";
import type { ParticipantStatus } from "@/lib/repo/types";

/** Return aggregate-only answer segments for one selected outcome question. */
export async function GET(req: Request, ctx: RouteContext<"/api/admin/interviews/[id]/analysis">) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const version = await getVersion(interview._id, interview.currentVersion);
  if (!version) return fail(404, "Survey version not found.");

  const url = new URL(req.url);
  const segmentById = (url.searchParams.get("segmentBy") ?? "").trim();
  const outcomeId = (url.searchParams.get("questionId") ?? "").trim();
  if (!segmentById || !outcomeId) return fail(400, "Choose a segmentation question and an outcome question.");
  const segmentQuestion = version.manifest.questions.find((question) => question.id === segmentById);
  const outcomeQuestion = version.manifest.questions.find((question) => question.id === outcomeId);
  if (!segmentQuestion) return fail(404, "Segmentation question not found in the current survey version.");
  if (!outcomeQuestion) return fail(404, "Outcome question not found in the current survey version.");
  if (segmentQuestion.id === outcomeQuestion.id) return fail(400, "Choose an outcome question other than the segmentation question.");
  if (!canSegmentByAnswer(segmentQuestion)) return fail(400, "Segment by a single-choice, dropdown, checkbox, or scale question. Text, date, and free-form number questions cannot define groups.");

  const requested = (url.searchParams.get("statuses") ?? ANALYTICS_STATUSES.join(",")).split(",").map((status) => status.trim());
  if (!requested.length || requested.some((status) => !ANALYTICS_STATUSES.includes(status as ParticipantStatus))) {
    return fail(400, "Choose one or more supported participant statuses.");
  }
  const statuses = ANALYTICS_STATUSES.filter((status) => requested.includes(status)) as ParticipantStatus[];
  if (!statuses.length) return fail(400, "Choose one or more supported participant statuses.");
  const compareStatuses = url.searchParams.get("compareStatuses") === "true";
  const analysis = await summarizeAnswerSegments(
    segmentQuestion,
    [outcomeQuestion],
    iterateAnalyticsParticipants(id, [segmentQuestion.id, outcomeQuestion.id], { statuses }),
    statuses,
    compareStatuses,
  );
  const participantCount = statuses.reduce((count, status) => count + analysis.statusCounts[status], 0);
  return json({
    ok: true,
    interviewId: id,
    surveyVersion: version.version,
    asOf: analysis.asOf,
    segmentBy: { id: segmentQuestion.id, type: segmentQuestion.type, label: segmentQuestion.label },
    outcome: { id: outcomeQuestion.id, type: outcomeQuestion.type, label: outcomeQuestion.label },
    scope: { statuses, participantCount, statusCounts: analysis.statusCounts, compareStatuses },
    segments: analysis.segments,
    methodology: [
      "Answer segments use the selected current-version question and only the participant statuses shown in scope. Outcome summaries exclude the segmentation question and use the same projected participant scan.",
      "Single-choice, dropdown, and scale answers place each person in one answer segment. Checkbox answers can place one person in several option segments; those segment counts and percentages overlap and must not be added together.",
      "No stored answer includes blank and note-only dimension responses; it does not mean the person was eligible to see a routed question. Invalid stored dimension values appear as Unmapped answer.",
      "No minimum group threshold is applied; every answer option is returned, including groups with one person or zero people. Outcome percentages use that segment's valid-answer denominator; this is a descriptive result, not an anonymity guarantee.",
      ...(compareStatuses ? ["Status summaries for all selected answer segments share this asOf and one participant scan; updates during the live read are not isolated by a database snapshot."] : []),
    ],
  });
}
