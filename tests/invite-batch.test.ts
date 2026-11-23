import { describe, expect, it, vi } from "vitest";
import { MAX_INVITES_PER_BATCH, MAX_MCP_INVITES_PER_BATCH } from "../src/lib/participant-limits";
import { sendInviteBatch, validateInviteBatch } from "../src/lib/mail/invite-batch";

const interviewId = "111111111111111111111111";
const personIds = ["222222222222222222222222", "333333333333333333333333"];

describe("bounded invite batches", () => {
  it("validates interview and distinct bounded person IDs", () => {
    expect(validateInviteBatch(interviewId, personIds)).toBeNull();
    expect(validateInviteBatch("bad", personIds)).toMatch(/interviewId/);
    expect(validateInviteBatch(interviewId, [])).toMatch(/1 to/);
    expect(validateInviteBatch(interviewId, Array.from({ length: MAX_INVITES_PER_BATCH + 1 }, () => personIds[0]))).toMatch(/1 to/);
    expect(validateInviteBatch(interviewId, [personIds[0], personIds[0]])).toMatch(/duplicates/);
    expect(validateInviteBatch(interviewId, ["bad"])).toMatch(/valid person id/);
    expect(validateInviteBatch(interviewId, Array.from({ length: MAX_MCP_INVITES_PER_BATCH + 1 }, (_, index) => (index + 4).toString(16).padStart(24, "0")), MAX_MCP_INVITES_PER_BATCH)).toMatch(/1 to 1/);
  });

  it("checks interview membership and sends one at a time while returning every outcome", async () => {
    const active = new Set<string>();
    let maxActive = 0;
    const send = vi.fn(async ({ personId }: { personId: string }) => {
      active.add(personId);
      maxActive = Math.max(maxActive, active.size);
      await Promise.resolve();
      active.delete(personId);
      return personId === personIds[0]
        ? { ok: true as const, result: "sent" as const, to: "ada@example.com", sentAt: "2026-11-24T00:00:00.000Z", interviewId, personId }
        : { ok: false as const, code: "rate_limited" as const, error: "Wait before sending again." };
    });
    const result = await sendInviteBatch({ interviewId, personIds, triggeredBy: "admin" }, {
      loadPerson: vi.fn(async (id: string) => ({ id, interviewId, name: "Ada", token: "x", status: "invited" as const, answers: {}, revision: 0, createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z" })),
      send,
    });

    expect(maxActive).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.outcomes).toMatchObject([
      { personId: personIds[0], ok: true, result: "sent" },
      { personId: personIds[1], ok: false, code: "rate_limited" },
    ]);
  });

  it("refuses to send a person who does not belong to the requested interview", async () => {
    const send = vi.fn();
    const result = await sendInviteBatch({ interviewId, personIds: [personIds[0]], triggeredBy: "admin" }, {
      loadPerson: async (id) => ({ id, interviewId: "444444444444444444444444", name: "Other", token: "x", status: "invited" as const, answers: {}, revision: 0, createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z" }),
      send,
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ ok: false, code: "not_found" });
  });

  it("continues after an unexpected per-person failure and reports the outcome as unknown", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("SMTP result uncertain"))
      .mockResolvedValueOnce({ ok: true as const, result: "sent" as const, to: "grace@example.com", sentAt: "2026-11-24T00:00:00.000Z", interviewId, personId: personIds[1] });
    const result = await sendInviteBatch({ interviewId, personIds, triggeredBy: "mcp" }, {
      loadPerson: async (id) => ({ id, interviewId, name: "Person", token: "x", status: "invited" as const, answers: {}, revision: 0, createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z" }),
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.outcomes[0]).toMatchObject({ ok: false, code: "outcome_unknown", personId: personIds[0] });
    expect(result.outcomes[1]).toMatchObject({ ok: true, result: "sent", personId: personIds[1] });
  });

  it("distinguishes preflight read failures from ambiguous send outcomes", async () => {
    const send = vi.fn();
    const result = await sendInviteBatch({ interviewId, personIds: [personIds[0]], triggeredBy: "mcp" }, {
      loadPerson: async () => { throw new Error("database unavailable"); },
      send,
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ ok: false, code: "preflight_unavailable" });
    if (!result.outcomes[0].ok) expect(result.outcomes[0].error).toContain("No message was sent");
  });
});
