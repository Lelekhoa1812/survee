import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    participant: { name: "Ada", status: "invited", revision: 0, answers: {} },
    interview: { name: "Study", status: "open" },
    version: { version: 7, manifest: { title: "Study", questions: [] } },
  },
  loadByToken: vi.fn(),
  saveAnswers: vi.fn(),
  submitAnswers: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
  json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
  readJson: async (req: Request) => {
    try { return { ok: true, data: await req.json() }; }
    catch { return { ok: false, res: new Response(JSON.stringify({ ok: false }), { status: 400 }) }; }
  },
}));
vi.mock("@/lib/repo", () => ({
  loadByToken: mocks.loadByToken,
  saveAnswers: mocks.saveAnswers,
  submitAnswers: mocks.submitAnswers,
}));
vi.mock("@/lib/tokens", () => ({ looksLikeToken: () => true }));
vi.mock("@/lib/visit", () => ({ shouldRecordVisit: () => false }));

import { GET as getRespondent } from "../src/app/api/p/[token]/route";
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
  mocks.saveAnswers.mockResolvedValue({ ok: true, revision: 1, savedAt: "2026-11-16T00:00:00.000Z", status: "in_progress" });
  mocks.submitAnswers.mockResolvedValue({ ok: true, submittedAt: "2026-11-16T00:00:00.000Z" });
});

describe("respondent questionnaire version routes", () => {
  it("returns the loaded immutable version with the questionnaire", async () => {
    const response = await getRespondent(request(`https://kqa.local/api/p/${token}`, "GET"), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ version: 7, title: "Study" });
  });

  it("requires and forwards the loaded version on answer saves", async () => {
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { version: 7, answers: { q1: { value: "answer" } } }), params);

    expect(response.status).toBe(200);
    expect(mocks.saveAnswers).toHaveBeenCalledWith(token, 7, { q1: { value: "answer" } });
  });

  it("rejects an answer save without a version before reaching the repository", async () => {
    const response = await saveRespondentAnswers(request(`https://kqa.local/api/p/${token}/answers`, "PUT", { answers: { q1: { value: "answer" } } }), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "questionnaire_version_changed" });
    expect(mocks.saveAnswers).not.toHaveBeenCalled();
  });

  it("requires and forwards the loaded version on submit", async () => {
    const response = await submitRespondentAnswers(request(`https://kqa.local/api/p/${token}/submit`, "POST", { version: 7 }), params);

    expect(response.status).toBe(200);
    expect(mocks.submitAnswers).toHaveBeenCalledWith(token, 7);
  });

  it("rejects submit without a version before reaching the repository", async () => {
    const response = await submitRespondentAnswers(request(`https://kqa.local/api/p/${token}/submit`, "POST", {}), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "questionnaire_version_changed" });
    expect(mocks.submitAnswers).not.toHaveBeenCalled();
  });

  it("preserves the stale-version code returned by the repository", async () => {
    mocks.submitAnswers.mockResolvedValue({ ok: false, status: 409, error: "Reload", code: "questionnaire_version_changed" });

    const response = await submitRespondentAnswers(request(`https://kqa.local/api/p/${token}/submit`, "POST", { version: 6 }), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "questionnaire_version_changed" });
  });
});
