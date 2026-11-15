import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTenantPrincipal } from "../src/lib/tenant-context";

process.env.SESSION_SECRET = "block-patch-test-secret-0123456789";

const fixture = readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8");
const state = vi.hoisted(() => ({
  interviewId: "0123456789abcdef01234567",
  currentVersion: 2,
  compatibilityImpact: false,
  publish: vi.fn(async () => ({ version: 3 })),
}));

vi.mock("../src/lib/repo", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/repo")>("../src/lib/repo");
  const fixture = readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8");
  const { checkHtml: checkFixture } = await import("../src/lib/diagnostics/static");
  return {
    ...actual,
    getInterview: vi.fn(async () => ({
      _id: new ObjectId(state.interviewId), name: "Interview", mode: "multi", status: "open",
      currentVersion: state.currentVersion, createdAt: new Date(), updatedAt: new Date(),
    })),
    getVersion: vi.fn(async (_id: ObjectId, version: number) => version === state.currentVersion ? ({
      version, fileName: "starter.kqa.html", html: fixture,
      htmlSha256: createHash("sha256").update(fixture).digest("hex"),
      manifest: checkFixture(fixture).manifest!,
    }) : null),
    publishVersionIfCurrent: state.publish,
  };
});

vi.mock("../src/lib/survey", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/survey")>("../src/lib/survey");
  return {
    ...actual,
    withCompat: async (prepared: Awaited<ReturnType<typeof actual.prepareSurvey>>) => {
      if (state.compatibilityImpact) prepared.report.diagnostics.push({ code: "KQA700", severity: "warning", category: "compat", title: "Impact", message: "Saved answers may be affected.", fix: "Review the impact." });
      return prepared;
    },
  };
});

import { dispatchTool } from "../src/lib/mcp/tools";

const call = (name: string, args: Record<string, unknown>, tenantId = "axion") =>
  withTenantPrincipal({ tenantId, role: "service", source: "service_token" }, () => dispatchTool(name, args));
const interviewId = state.interviewId;

const operation = {
  op: "add",
  question: { id: "new-q", type: "text", section: "writing", label: "New prompt" },
  html: '<article class="kq-q" data-kqa-question-id="new-q"><div class="kq-q-head"><h3><label for="f-new-q">New prompt</label></h3></div><input id="f-new-q" type="text" data-kqa="new-q"></article>',
};
const baseHash = createHash("sha256").update(fixture).digest("hex");

beforeEach(() => {
  state.currentVersion = 2;
  state.compatibilityImpact = false;
  state.publish.mockClear();
  state.publish.mockResolvedValue({ version: 3 });
});

describe("MCP questionnaire block patch", () => {
  it("previews without publishing, then applies the same tenant-bound candidate", async () => {
    const preview = await call("preview_questionnaire_block_patch", { interviewId, operations: [operation] });
    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({
      ok: true, currentVersion: 2, baseHash, staticValid: true,
      candidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      previewToken: expect.any(String),
      operationChanges: [{ op: "add", questionId: "new-q", section: "writing" }],
    });
    expect(state.publish).not.toHaveBeenCalled();

    const applied = await call("apply_questionnaire_block_patch", {
      interviewId, operations: [operation], expectedVersion: 2, baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
    });
    expect(applied.isError).toBeFalsy();
    expect(applied.structuredContent).toMatchObject({ ok: true, version: 3, previousVersion: 2 });
    expect(state.publish).toHaveBeenCalledWith(interviewId, 2, baseHash, expect.objectContaining({ html: expect.stringContaining('data-kqa="new-q"') }));
  });

  it("returns complete definitions for added and removed questions in the preview", async () => {
    const addition = {
      op: "add",
      question: {
        id: "estimate", type: "number", section: "writing", label: "Estimated team size?",
        help: "Use your current headcount.", required: true, min: 2, max: 20, step: 2,
        note: { label: "Context", placeholder: "Optional detail" },
      },
      html: '<article class="kq-q" data-kqa-question-id="estimate"><h3><label for="f-estimate">Estimated team size?</label></h3><p class="kq-help">Use your current headcount.</p><input id="f-estimate" type="number" data-kqa="estimate" min="2" max="20" step="2"></article>',
    };
    const added = await call("preview_questionnaire_block_patch", { interviewId, operations: [addition] });

    expect(added.isError).toBeFalsy();
    expect(added.structuredContent.questionChanges).toMatchObject({
      addedIds: ["estimate"],
      addedQuestions: [{
        id: "estimate",
        type: "number",
        label: "Estimated team size?",
        help: "Use your current headcount.",
        required: true,
        section: "writing",
        min: 2,
        max: 20,
        step: 2,
        note: { label: "Context", placeholder: "Optional detail" },
      }],
      removedIds: [],
      removedQuestions: [],
    });

    const removed = await call("preview_questionnaire_block_patch", {
      interviewId,
      operations: [{ op: "delete", questionId: "priority" }],
    });
    expect(removed.isError).toBeFalsy();
    expect(removed.structuredContent.questionChanges).toMatchObject({
      addedIds: [],
      addedQuestions: [],
      removedIds: ["priority"],
      removedQuestions: [{
        id: "priority",
        type: "single",
        label: "Which area should we start with?",
        help: "Pick one. You can change it any time before you submit.",
        required: true,
        section: "choices",
        options: [
          { value: "accuracy", label: "Accuracy of the ratings" },
          { value: "speed", label: "Speed of each run" },
          { value: "cost", label: "Cost per lead" },
        ],
        note: true,
      }],
    });
  });

  it("rejects altered operations and requires compatibility acknowledgement", async () => {
    state.compatibilityImpact = true;
    const preview = await call("preview_questionnaire_block_patch", { interviewId, operations: [operation] });
    const mismatched = await call("apply_questionnaire_block_patch", {
      interviewId, operations: [{ op: "delete", questionId: "region" }], expectedVersion: 2, baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
    });
    expect(mismatched.structuredContent.code).toBe("candidate_changed");
    expect(state.publish).not.toHaveBeenCalled();

    const args = {
      interviewId, operations: [operation], expectedVersion: 2, baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
      compatibilityHash: preview.structuredContent.compatibilityHash,
    };
    const unacknowledged = await call("apply_questionnaire_block_patch", args);
    expect(unacknowledged.structuredContent.code).toBe("acknowledgement_required");
    expect(state.publish).not.toHaveBeenCalled();

    const acknowledged = await call("apply_questionnaire_block_patch", { ...args, acknowledgeCompatibilityImpact: true });
    expect(acknowledged.isError).toBeFalsy();
    expect(state.publish).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-tenant and stale previews", async () => {
    const preview = await call("preview_questionnaire_block_patch", { interviewId, operations: [operation] });
    const crossTenant = await call("apply_questionnaire_block_patch", {
      interviewId, operations: [operation], expectedVersion: 2, baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
    }, "another-tenant");
    expect(crossTenant.structuredContent.code).toBe("invalid_preview");

    state.currentVersion = 3;
    const stale = await call("apply_questionnaire_block_patch", {
      interviewId, operations: [operation], expectedVersion: 2, baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
    });
    expect(stale.structuredContent.code).toBe("stale_preview");
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("previews and applies positioned question moves through the same signed token", async () => {
    const move = { op: "move", questionId: "confidence", beforeQuestionId: "team-size" };
    const preview = await call("preview_questionnaire_block_patch", { interviewId, operations: [move] });
    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({
      ok: true,
      operationChanges: [{ op: "move", questionId: "confidence", section: "writing" }],
    });
    expect(preview.structuredContent.questionsAfter).toEqual(expect.arrayContaining([
      { id: "confidence", type: "scale", section: "writing", label: "How confident are you in your current process?", required: false },
    ]));
    const reordered = (preview.structuredContent.questionsAfter as { id: string }[]).map(({ id }) => id);
    expect(reordered.indexOf("confidence")).toBe(reordered.indexOf("team-size") - 1);

    const changedTarget = await call("apply_questionnaire_block_patch", {
      interviewId,
      operations: [{ op: "move", questionId: "confidence", afterQuestionId: "team-size" }],
      expectedVersion: 2,
      baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
    });
    expect(changedTarget.structuredContent.code).toBe("candidate_changed");
    expect(state.publish).not.toHaveBeenCalled();

    const applied = await call("apply_questionnaire_block_patch", {
      interviewId,
      operations: [move],
      expectedVersion: 2,
      baseHash,
      candidateHash: preview.structuredContent.candidateHash,
      previewToken: preview.structuredContent.previewToken,
    });
    expect(applied.isError).toBeFalsy();
    expect(applied.structuredContent).toMatchObject({ ok: true, version: 3, previousVersion: 2 });
    expect(state.publish).toHaveBeenCalledTimes(1);
  });
});
