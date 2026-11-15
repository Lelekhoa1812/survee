import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  interview: { _id: "interview", currentVersion: 1 },
  version: {
    version: 1,
    manifest: { questions: [
      { id: "fit", type: "single", label: "Strategic fit", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      { id: "budget", type: "number", label: "Budget", min: 0, max: 10 },
      { id: "confidence", type: "single", label: "Confidence", options: [{ value: "high", label: "High" }, { value: "low", label: "Low" }] },
    ] },
  },
  rows: [] as any[],
  getInterview: vi.fn(),
  getVersion: vi.fn(),
  iterate: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  guardAdmin: async () => state.denied,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (value: unknown) => new Response(JSON.stringify(value), { status: 200 }),
}));

vi.mock("@/lib/repo", () => ({
  getInterview: state.getInterview,
  getVersion: state.getVersion,
  iterateAnalyticsParticipants: state.iterate,
}));

import { GET } from "../src/app/api/admin/interviews/[id]/analysis/route";

function request(query: string) {
  return new Request(`https://kqa.local/api/admin/interviews/interview/analysis?surveyVersion=1&${query}`);
}

describe("interview answer-segmentation route", () => {
  beforeEach(() => {
    state.denied = null;
    state.interview = { _id: "interview", currentVersion: 1 };
    state.rows = [
      { status: "submitted", answers: { fit: { value: "yes" }, budget: { value: 2 }, confidence: { value: "high" } } },
      { status: "invited", answers: { fit: { value: "retired" }, budget: { value: 4 }, confidence: { value: "low" } } },
      { status: "in_progress", answers: { fit: { note: "private note" }, budget: { value: 3 }, confidence: { value: "high" } } },
    ];
    state.getInterview.mockReset().mockResolvedValue(state.interview);
    state.getVersion.mockReset().mockResolvedValue(state.version);
    state.iterate.mockReset().mockImplementation((_id: string, _questionIds: string[], options: { statuses: string[] }) => (async function* () {
      for (const row of state.rows) if (options.statuses.includes(row.status)) yield row;
    })());
  });

  it("requires an admin before reading tenant interview data", async () => {
    state.denied = new Response("Unauthorized", { status: 401 });
    const response = await GET(request("segmentBy=fit&questionId=budget"), { params: Promise.resolve({ id: "interview" }) });
    expect(response.status).toBe(401);
    expect(state.getInterview).not.toHaveBeenCalled();
  });

  it("requires the analysis page's survey version before reading aggregates", async () => {
    const response = await GET(new Request("https://kqa.local/api/admin/interviews/interview/analysis?segmentBy=fit&questionId=budget"), { params: Promise.resolve({ id: "interview" }) });
    expect(response.status).toBe(400);
    expect(state.getInterview).not.toHaveBeenCalled();
    expect(state.iterate).not.toHaveBeenCalled();
  });

  it("rejects stale survey versions before scanning participant answers", async () => {
    state.interview = { _id: "interview", currentVersion: 2 };
    state.getInterview.mockResolvedValue(state.interview);
    const response = await GET(request("segmentBy=fit&questionId=budget"), { params: Promise.resolve({ id: "interview" }) });
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toContain("survey changed while the page was open");
    expect(state.getVersion).not.toHaveBeenCalled();
    expect(state.iterate).not.toHaveBeenCalled();
  });

  it("returns aggregate-only outcome summaries in each segment with one scan", async () => {
    const response = await GET(request("segmentBy=fit&questionId=budget&compareStatuses=true"), { params: Promise.resolve({ id: "interview" }) });
    const body = await response.json() as { ok: boolean; interviewId: string; surveyVersion: number; asOf: string; scope: { participantCount: number; compareStatuses: boolean }; segments: { label: string; kind: string; participantCount: number; disclosureRisk: { singletonSegment: boolean; singletonStatusGroups: string[] }; summaries: { budget: { numeric: { n: number; mean: number } | null; disclosureRisk: { singletonNumericSummary: boolean } } }; statusSummaries?: Record<string, Record<string, unknown>> }[]; methodology: string[] };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ interviewId: "interview", surveyVersion: 1 });
    expect(body).toMatchObject({ ok: true, scope: { participantCount: 3, compareStatuses: true } });
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
    expect(body.segments.find((segment) => segment.label === "Yes")).toMatchObject({ participantCount: 1, disclosureRisk: { singletonSegment: true, singletonStatusGroups: ["submitted"] }, summaries: { budget: { numeric: { n: 1, mean: 2 } } } });
    expect(body.segments.find((segment) => segment.label === "Yes")?.summaries.budget.disclosureRisk.singletonNumericSummary).toBe(true);
    expect(body.segments.find((segment) => segment.kind === "no_answer")).toMatchObject({ label: "No stored answer", participantCount: 1, disclosureRisk: { singletonSegment: true } });
    expect(body.segments.find((segment) => segment.kind === "unmapped")).toMatchObject({ label: "Unmapped answer", participantCount: 1, disclosureRisk: { singletonSegment: true }, summaries: { budget: { numeric: { n: 1, mean: 4 } } } });
    expect(body.segments.find((segment) => segment.label === "No")?.participantCount).toBe(0);
    expect(state.iterate).toHaveBeenCalledOnce();
    expect(state.iterate).toHaveBeenCalledWith("interview", ["fit", "budget"], { statuses: ["invited", "in_progress", "submitted"] });
    expect(JSON.stringify(body)).not.toContain("private note");
    expect(JSON.stringify(body)).not.toContain("retired");
    expect(body.methodology.join(" ")).toContain("No minimum group threshold is applied");
  });

  it("summarizes several selected outcomes from one projected participant scan", async () => {
    const response = await GET(request("segmentBy=fit&questionId=budget&questionId=confidence"), { params: Promise.resolve({ id: "interview" }) });
    const body = await response.json() as { ok: boolean; outcomes: { id: string }[]; segments: { summaries: Record<string, unknown> }[]; methodology: string[] };
    expect(response.status).toBe(200);
    expect(body.outcomes.map(({ id }) => id)).toEqual(["budget", "confidence"]);
    expect(body.segments[0].summaries).toHaveProperty("budget");
    expect(body.segments[0].summaries).toHaveProperty("confidence");
    expect(state.iterate).toHaveBeenCalledOnce();
    expect(state.iterate).toHaveBeenCalledWith("interview", ["fit", "budget", "confidence"], { statuses: ["invited", "in_progress", "submitted"] });
    expect(body.methodology.join(" ")).toContain("All selected outcome summaries");
  });

  it("rejects free-form numeric dimensions and self-outcomes before scanning participants", async () => {
    const invalidDimension = await GET(request("segmentBy=budget&questionId=fit"), { params: Promise.resolve({ id: "interview" }) });
    expect(invalidDimension.status).toBe(400);
    expect(state.iterate).not.toHaveBeenCalled();
    const sameQuestion = await GET(request("segmentBy=fit&questionId=fit"), { params: Promise.resolve({ id: "interview" }) });
    expect(sameQuestion.status).toBe(400);
    const duplicateQuestion = await GET(request("segmentBy=fit&questionId=budget&questionId=budget"), { params: Promise.resolve({ id: "interview" }) });
    expect(duplicateQuestion.status).toBe(400);
    const tooMany = Array.from({ length: 21 }, (_, index) => `questionId=q${index}`).join("&");
    const overLimit = await GET(request(`segmentBy=fit&${tooMany}`), { params: Promise.resolve({ id: "interview" }) });
    expect(overLimit.status).toBe(400);
    expect(state.iterate).not.toHaveBeenCalled();
  });
});
