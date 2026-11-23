import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/lib/questionnaire-preview";

const state = vi.hoisted(() => ({
  session: { tenantId: "tenant-1", role: "owner" } as any,
  denied: null as Response | null,
  body: {} as any,
  currentVersion: 2,
  baseHash: "a".repeat(64),
  invalid: false,
  compatibilityImpact: false,
  currentManifest: null as any,
  candidateManifest: null as any,
  publish: vi.fn(async () => ({ version: 3 })),
}));

const interviewId = "0123456789abcdef01234567";
const candidate = "<html><body><h1>Updated survey</h1></body></html>";
const currentManifest = { format: "kqa/1", title: "Current survey", questions: [{ id: "q1", type: "text", label: "Old wording" }] };
const candidateManifest = { format: "kqa/1", title: "Updated survey", questions: [{ id: "q1", type: "text", label: "New question wording" }] };

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  adminSession: async () => state.session,
  readJson: async () => ({ ok: true, data: state.body }),
  str: (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
  json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
}));

vi.mock("@/lib/repo", () => ({
  getInterview: async () => ({ _id: "interview-object-id", currentVersion: state.currentVersion }),
  getVersion: async () => ({
    version: 1,
    htmlSha256: state.baseHash,
    html: candidate,
    fileName: "previous.html",
    manifest: state.currentManifest,
  }),
  publishVersionIfCurrent: state.publish,
}));

vi.mock("@/lib/survey", () => ({
  prepareSurvey: (html: string) => {
    const diagnostics = state.invalid ? [{ code: "KQA001", severity: "error", category: "format", title: "Invalid file", message: "Invalid candidate", fix: "Fix the file" }] : [];
    const manifest = state.candidateManifest;
    const report = { ok: !state.invalid, diagnostics, counts: { error: state.invalid ? 1 : 0, warning: 0, info: 0 }, manifest };
    return { report, markdown: "checker report", survey: state.invalid ? undefined : { html: html.replace(/^\uFEFF/, ""), manifest, check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" } } };
  },
  withCompat: async (prepared: any) => {
    if (state.compatibilityImpact) {
      prepared.report.diagnostics.push({ code: "KQA709", severity: "warning", category: "compat", title: "Saved repeated records may not fit", message: "Existing records may not match the changed field definition.", fix: "Review the impact" });
    }
    return prepared;
  },
}));

import { GET, POST } from "../src/app/api/admin/interviews/[id]/versions/route";

function request() {
  return new Request("https://kqa.local/api/admin/interviews/0123456789abcdef01234567/versions", { method: "POST" });
}

function previewBody() {
  return { action: "preview", html: candidate, fileName: "updated.html" };
}

async function getPreview() {
  state.body = previewBody();
  const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
  return { response, data: await response.json() };
}

function applyBody(preview: Record<string, unknown>, html = candidate) {
  return {
    action: "apply",
    html,
    fileName: "updated.html",
    expectedVersion: 2,
    baseHash: state.baseHash,
    candidateHash: sha256(candidate),
    compatibilityHash: preview.compatibilityHash,
    previewToken: preview.previewToken,
    acknowledgeCompatibilityImpact: false,
  };
}

beforeEach(() => {
  state.session = { tenantId: "tenant-1", role: "owner" };
  state.denied = null;
  state.body = {};
  state.currentVersion = 2;
  state.baseHash = "a".repeat(64);
  state.invalid = false;
  state.compatibilityImpact = false;
  state.currentManifest = currentManifest;
  state.candidateManifest = candidateManifest;
  state.publish.mockReset().mockResolvedValue({ version: 3 });
});

describe("host questionnaire version preview and apply", () => {
  it("loads a stored version as a candidate without publishing it", async () => {
    const response = await GET(new Request(`https://kqa.local/api/admin/interviews/${interviewId}/versions?action=restore&restoreVersion=1`), { params: Promise.resolve({ id: interviewId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ html: candidate, fileName: "previous.html", version: 1 });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("rejects the former one-call publish request", async () => {
    state.body = { html: candidate, fileName: "updated.html" };
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(400);
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("returns a signed, non-mutating preview with before-and-after question details", async () => {
    const { response, data } = await getPreview();
    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      staticValid: true,
      currentVersion: 2,
      baseHash: state.baseHash,
      candidateHash: sha256(candidate),
      previewToken: expect.any(String),
      changes: {
        questionCountBefore: 1,
        questionCountAfter: 1,
        questionChanges: {
          updated: [{ previous: { id: "q1", label: "Old wording" }, question: { id: "q1", label: "New question wording" }, fields: ["label"] }],
        },
        questionsAfter: [{ id: "q1", type: "text", label: "New question wording" }],
      },
    });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("returns complete semantic question and section changes for host review", async () => {
    state.currentManifest = {
      format: "kqa/1",
      title: "Current survey",
      sections: [
        { id: "intro", title: "Introduction", description: "Start here" },
        { id: "end", title: "End" },
      ],
      questions: [
        { id: "q1", type: "single", label: "Choice", section: "intro", options: [{ label: "Old A", value: "a" }, { label: "B", value: "b" }], help: "Choose one" },
        { id: "q2", type: "number", label: "Score", min: 0, max: 100 },
      ],
    };
    state.candidateManifest = {
      format: "kqa/1",
      title: "Updated survey",
      sections: [
        { id: "end", title: "End" },
        { id: "intro", title: "Getting started", description: "Read this first" },
      ],
      questions: [
        { id: "q1", type: "single", label: "Choice", section: "intro", options: [{ label: "New A", value: "a" }, { label: "B", value: "b" }], help: "Select one" },
        { id: "q2", type: "number", label: "Score", min: 1, max: 10 },
      ],
    };

    const { response, data } = await getPreview();
    expect(response.status).toBe(200);
    expect(data.changes.questionChanges.updated).toEqual([
      expect.objectContaining({
        previous: expect.objectContaining({ options: [{ label: "Old A", value: "a" }, { label: "B", value: "b" }], help: "Choose one" }),
        question: expect.objectContaining({ options: [{ label: "New A", value: "a" }, { label: "B", value: "b" }], help: "Select one" }),
        fields: ["options", "help"],
      }),
      expect.objectContaining({
        previous: expect.objectContaining({ min: 0, max: 100 }),
        question: expect.objectContaining({ min: 1, max: 10 }),
        fields: ["min", "max"],
      }),
    ]);
    expect(data.changes.sectionChanges).toEqual({
      added: [],
      removed: [],
      updated: [{
        previous: { id: "intro", title: "Introduction", description: "Start here" },
        section: { id: "intro", title: "Getting started", description: "Read this first" },
        fields: ["title", "description"],
      }],
      moved: [{ id: "intro", beforePosition: 1, afterPosition: 2 }],
    });
    expect(data.changes.questionsAfter[0].options).toEqual([{ label: "New A", value: "a" }, { label: "B", value: "b" }]);
  });

  it("publishes only the candidate tied to the reviewed preview", async () => {
    const { data: preview } = await getPreview();
    state.body = applyBody(preview);
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, version: 3, previousVersion: 2, candidateHash: sha256(candidate) });
    expect(state.publish).toHaveBeenCalledWith(interviewId, 2, state.baseHash, expect.objectContaining({ html: candidate }), "host_patch");
  });

  it("returns a specific conflict when a referenced workspace image is unavailable", async () => {
    const { data: preview } = await getPreview();
    state.body = applyBody(preview);
    state.publish.mockResolvedValueOnce({ assetUnavailable: true } as any);
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "asset_unavailable" });
  });

  it("rejects an altered candidate without publishing", async () => {
    const { data: preview } = await getPreview();
    state.body = applyBody(preview, `${candidate} changed`);
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "candidate_changed" });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("requires compatibility acknowledgement for the exact findings in the preview", async () => {
    state.compatibilityImpact = true;
    const { data: preview } = await getPreview();
    state.body = applyBody(preview);
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "acknowledgement_required" });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("publishes compatibility changes only after explicit acknowledgement", async () => {
    state.compatibilityImpact = true;
    const { data: preview } = await getPreview();
    state.body = { ...applyBody(preview), acknowledgeCompatibilityImpact: true };
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, compatibilityImpact: true });
    expect(state.publish).toHaveBeenCalledTimes(1);
  });

  it("rejects compatibility findings that changed after preview", async () => {
    state.compatibilityImpact = true;
    const { data: preview } = await getPreview();
    state.compatibilityImpact = false;
    state.body = { ...applyBody(preview), acknowledgeCompatibilityImpact: true };
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "stale_preview" });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("binds the preview to the uploaded file name", async () => {
    const { data: preview } = await getPreview();
    state.body = { ...applyBody(preview), fileName: "renamed.html" };
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_preview" });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("does not create a preview for a candidate that fails the checker", async () => {
    state.invalid = true;
    const { response, data } = await getPreview();
    expect(response.status).toBe(422);
    expect(data).toMatchObject({ ok: false, staticValid: false });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("rejects a preview when the live version has changed", async () => {
    const { data: preview } = await getPreview();
    state.currentVersion = 3;
    state.body = applyBody(preview);
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "stale_preview" });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("binds the preview to the workspace that reviewed it", async () => {
    const { data: preview } = await getPreview();
    state.session.tenantId = "another-tenant";
    state.body = applyBody(preview);
    const response = await POST(request(), { params: Promise.resolve({ id: interviewId }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_preview" });
    expect(state.publish).not.toHaveBeenCalled();
  });
});

