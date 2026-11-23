import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    tenantId: "tenant-1",
    participant: { name: "Ada", status: "invited", revision: 0, writeEpoch: 0, answers: {}, recordGroups: { people: [{ id: "row-1", values: {}, revision: 0, fieldRevisions: {} }] } },
    interview: { name: "Study", status: "open" },
    version: { version: 7, html: "<!doctype html><title>Study</title>", manifest: { title: "Study", sections: [{ id: "context", title: "About you" }], questions: [] as { id: string }[] } as Record<string, any> },
  },
  loadByToken: vi.fn(),
  getWorkspacePolicy: vi.fn(),
  ensureQuestionOrderAssignment: vi.fn(),
  shouldRecordVisit: vi.fn(() => false),
  respondentRateLimit: vi.fn(async () => null as Response | null),
  saveAnswers: vi.fn(),
  submitAnswers: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
  json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  readJson: async (req: Request) => {
    try { return { ok: true, data: await req.json() }; }
    catch { return { ok: false, res: new Response(JSON.stringify({ ok: false }), { status: 400 }) }; }
  },
}));
vi.mock("@/lib/repo", () => ({
  loadByToken: mocks.loadByToken,
  ensureQuestionOrderAssignment: mocks.ensureQuestionOrderAssignment,
  saveAnswers: mocks.saveAnswers,
  submitAnswers: mocks.submitAnswers,
}));
vi.mock("@/lib/repo/workspace-policy", () => ({ getWorkspacePolicy: mocks.getWorkspacePolicy }));
vi.mock("@/lib/tokens", () => ({ looksLikeToken: () => true }));
vi.mock("@/lib/visit", () => ({ shouldRecordVisit: mocks.shouldRecordVisit }));
vi.mock("@/lib/respondent-rate-limit", () => ({ respondentRateLimit: mocks.respondentRateLimit }));

import { GET as getRespondent } from "../src/app/api/p/[token]/route";
import { GET as getQuestionnaireFrame } from "../src/app/api/frame/[token]/route";
import { PUT as saveRespondentAnswers } from "../src/app/api/p/[token]/answers/route";
import { POST as submitRespondentAnswers } from "../src/app/api/p/[token]/submit/route";

const token = "A".repeat(24);
const params = { params: Promise.resolve({ token }) };
const request = (url: string, method: string, body?: unknown) => new Request(url, {
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadByToken.mockResolvedValue(mocks.context);
  mocks.getWorkspacePolicy.mockResolvedValue({ analyticsMinimumCellSize: 5, respondentPolicy: null });
  mocks.ensureQuestionOrderAssignment.mockImplementation(async (input) => ({ ...input, assignedAt: "2026-11-16T00:00:00.000Z" }));
  mocks.shouldRecordVisit.mockReturnValue(false);
  mocks.respondentRateLimit.mockResolvedValue(null);
  mocks.saveAnswers.mockResolvedValue({ ok: true, revision: 1, savedAt: "2026-11-16T00:00:00.000Z", status: "in_progress" });
  mocks.submitAnswers.mockResolvedValue({ ok: true, submittedAt: "2026-11-16T00:00:00.000Z" });
});

describe("respondent questionnaire version routes", () => {
  it("returns the loaded immutable version with the questionnaire", async () => {
    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);

    expect(response.status).toBe(200);
    expect(mocks.respondentRateLimit).toHaveBeenCalledWith(expect.any(Request), token, "load");
    await expect(response.json()).resolves.toMatchObject({ version: 7, title: "Study", sections: [{ id: "context", title: "About you" }], recordGroups: { people: [{ id: "row-1" }] }, respondentPolicy: null });
    expect(mocks.getWorkspacePolicy).toHaveBeenCalledWith("tenant-1");
  });

  it("returns only workspace-authored respondent policy text to a valid respondent link", async () => {
    mocks.getWorkspacePolicy.mockResolvedValue({
      analyticsMinimumCellSize: 8,
      respondentPolicy: { notice: "Host-authored notice", purpose: "Host-authored purpose", retention: "Host-authored retention", contact: "host@example.test", withdrawal: "Host-authored withdrawal", revision: 4, updatedAt: "2026-11-20T00:00:00.000Z" },
    });

    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);

    const body = await response.json();
    expect(body).toMatchObject({
      respondentPolicy: {
        notice: "Host-authored notice", purpose: "Host-authored purpose", retention: "Host-authored retention",
        contact: "host@example.test", withdrawal: "Host-authored withdrawal",
      },
    });
    expect(body.respondentPolicy).not.toHaveProperty("revision");
    expect(body).not.toHaveProperty("analyticsMinimumCellSize");
    expect(mocks.getWorkspacePolicy).toHaveBeenCalledWith(mocks.context.tenantId);
  });

  it("does not look up workspace policy for an invalid respondent link", async () => {
    mocks.loadByToken.mockResolvedValueOnce(null);
    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);

    expect(response.status).toBe(404);
    expect(mocks.getWorkspacePolicy).not.toHaveBeenCalled();
  });

  it("throttles respondent reads before looking up a link", async () => {
    mocks.respondentRateLimit.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);

    expect(response.status).toBe(429);
    expect(mocks.loadByToken).not.toHaveBeenCalled();
  });

  it("rate limits questionnaire frame reads before loading HTML", async () => {
    const response = await getQuestionnaireFrame(request(`https://kqa.local/api/frame/${token}`, "GET"), params);

    expect(response.status).toBe(200);
    expect(mocks.respondentRateLimit).toHaveBeenCalledWith(expect.any(Request), token, "frame");
  });

  it("persists and returns a complete order on respondent visits while preserving canonical questions", async () => {
    mocks.shouldRecordVisit.mockReturnValue(true);
    mocks.context.version.manifest = {
      ...mocks.context.version.manifest,
      questionOrderGroups: [{ id: "context-pair", questionIds: ["first", "second"] }],
      questions: [{ id: "first" }, { id: "second" }, { id: "last" }],
    };
    mocks.ensureQuestionOrderAssignment.mockResolvedValue({
      surveyVersion: 7,
      algorithmVersion: "kqa-question-order-v1",
      groups: { "context-pair": ["second", "first"] },
      assignedAt: "2026-11-16T00:00:00.000Z",
    });

    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);
    const body = await response.json();

    expect(mocks.ensureQuestionOrderAssignment).toHaveBeenCalledWith(expect.objectContaining({
      surveyVersion: 7,
      algorithmVersion: "kqa-question-order-v1",
      groups: { "context-pair": expect.arrayContaining(["first", "second"]) },
    }));
    expect(body.questionOrder).toEqual(["second", "first", "last"]);
    expect(body.questions.map((question: { id: string }) => question.id)).toEqual(["first", "second", "last"]);
    expect(body.questionOrderAssignment.assignedAt).toBe("2026-11-16T00:00:00.000Z");
  });

  it("does not persist a proposed order for link prefetches", async () => {
    mocks.context.version.manifest = {
      ...mocks.context.version.manifest,
      questionOrderGroups: [{ id: "context-pair", questionIds: ["first", "second"] }],
      questions: [{ id: "first" }, { id: "second" }],
    };

    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);
    const body = await response.json();

    expect(mocks.ensureQuestionOrderAssignment).not.toHaveBeenCalled();
    expect(body.questionOrder).toHaveLength(2);
    expect(body.questionOrderAssignment.assignedAt).toBeUndefined();
  });

  it("returns a stable participant-specific option order and preserves fixed authored slots", async () => {
    const options = ["a", "other", "b", "c", "d"].map((value) => ({ value, label: value.toUpperCase() }));
    const question = { id: "choice", type: "single", label: "Choice", randomizeOptions: true, fixedOptionValues: ["other"], options };
    mocks.context.version.manifest = { ...mocks.context.version.manifest, questions: [question] };

    const first = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);
    const firstOrder = (await first.json()).questions[0].options.map((option: { value: string }) => option.value);
    const second = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);
    const secondOrder = (await second.json()).questions[0].options.map((option: { value: string }) => option.value);

    expect(firstOrder).toEqual(secondOrder);
    expect(firstOrder).toHaveLength(options.length);
    expect(new Set(firstOrder)).toEqual(new Set(options.map((option) => option.value)));
    expect(firstOrder[1]).toBe("other");
    expect(mocks.context.version.manifest.questions).toEqual([question]);
  });

  it("requires and forwards the loaded version on answer saves", async () => {
    const expectedAnswerRevisions = { q1: { value: 0, note: 0 } };
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { version: 7, writeEpoch: 0, answers: { q1: { value: "answer" } }, expectedAnswerRevisions }), params);

    expect(response.status).toBe(200);
    expect(mocks.saveAnswers).toHaveBeenCalledWith(token, 7, { q1: { value: "answer" } }, [], 0, expectedAnswerRevisions);
  });

  it("requires scalar field revisions before accepting answer writes", async () => {
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { version: 7, writeEpoch: 0, answers: { q1: { value: "answer" } } }), params);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "answer_conflict" });
    expect(mocks.saveAnswers).not.toHaveBeenCalled();
  });

  it("forwards explicit record operations alongside scalar answers", async () => {
    const recordOperations = [{ op: "set", questionId: "people", rowId: "row-1", fieldId: "name", expectedFieldRevision: 0, value: "Ada" }];
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { version: 7, writeEpoch: 0, recordOperations }), params);
    expect(response.status).toBe(200);
    expect(mocks.saveAnswers).toHaveBeenCalledWith(token, 7, {}, recordOperations, 0, undefined);
  });

  it("rejects malformed record operations before repository access", async () => {
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { version: 7, writeEpoch: 0, recordOperations: [{ op: "set", questionId: "people", rowId: "row.1", fieldId: "name", expectedFieldRevision: 0, value: "Ada" }] }), params);
    expect(response.status).toBe(400);
    expect(mocks.saveAnswers).not.toHaveBeenCalled();
  });

  it("returns a coded invalid_args error for a malformed answers object", async () => {
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { version: 7, writeEpoch: 0, answers: ["not", "an", "object"] }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "invalid_args" });
    expect(mocks.saveAnswers).not.toHaveBeenCalled();
  });

  it("rejects an answer save without a version before reaching the repository", async () => {
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { answers: { q1: { value: "answer" } } }), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "questionnaire_version_changed" });
    expect(mocks.saveAnswers).not.toHaveBeenCalled();
  });

  it("requires and forwards the loaded version on submit", async () => {
    const response = await submitRespondentAnswers(request(`https://kqa.local/api/p/${token}/submit`, "POST", { version: 7, writeEpoch: 0 }), params);

    expect(response.status).toBe(200);
    expect(mocks.submitAnswers).toHaveBeenCalledWith(token, 7, 0);
  });

  it("rejects submit without a version before reaching the repository", async () => {
    const response = await submitRespondentAnswers(request(`https://kqa.local/api/p/${token}/submit`, "POST", {}), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "questionnaire_version_changed" });
    expect(mocks.submitAnswers).not.toHaveBeenCalled();
  });

  it("preserves the stale-version code returned by the repository", async () => {
    mocks.submitAnswers.mockResolvedValue({ ok: false, status: 409, error: "Reload", code: "questionnaire_version_changed" });

    const response = await submitRespondentAnswers(request(`https://kqa.local/api/p/${token}/submit`, "POST", { version: 6, writeEpoch: 0 }), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "questionnaire_version_changed" });
  });
});
