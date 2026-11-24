import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: null as string | null | "invite_pending",
  previous: null as { kind: string; token?: string } | null,
  rotated: { kind: "not_found" } as { kind: string; token?: string },
  deliveryResult: { ok: false, code: "superseded", error: "The invite changed." } as unknown,
  guardAdmin: vi.fn(async (): Promise<NextResponse | null> => null),
  adminSession: vi.fn(async () => ({ userId: "user-1", tenantId: "tenant-1" })),
  getRegenerateLinkOperation: vi.fn(async () => mocks.previous),
  regenerateTokenWithOperation: vi.fn(async () => mocks.rotated),
  readJson: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status }),
  guardAdmin: mocks.guardAdmin,
  adminSession: mocks.adminSession,
  json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
  readJson: mocks.readJson,
  withServerErrors: (_route: string, handler: (...args: never[]) => Promise<NextResponse>) => handler,
}));
vi.mock("@/lib/mail/delivery", () => ({ checkInviteDelivery: vi.fn(async () => mocks.deliveryResult) }));
vi.mock("@/lib/mail/invite", () => ({ sendInvite: vi.fn() }));
vi.mock("@/lib/repo", () => ({
  getRegenerateLinkOperation: mocks.getRegenerateLinkOperation,
  regenerateTokenWithOperation: mocks.regenerateTokenWithOperation,
  reopenParticipant: vi.fn(),
}));

import { POST } from "../src/app/api/admin/people/[pid]/[action]/route";

const context = { params: Promise.resolve({ pid: "person-id", action: "token" }) };

const tokenRequest = (key?: string) => new Request("https://survee.example/api/admin/people/person-id/token", {
  method: "POST",
  headers: key ? { "Idempotency-Key": key } : {},
});

describe("participant private-link rotation route", () => {
  beforeEach(() => {
    mocks.previous = null;
    mocks.rotated = { kind: "not_found" };
    mocks.guardAdmin.mockReset().mockResolvedValue(null);
    mocks.adminSession.mockReset().mockResolvedValue({ userId: "user-1", tenantId: "tenant-1" });
    mocks.getRegenerateLinkOperation.mockClear();
    mocks.regenerateTokenWithOperation.mockClear();
  });

  it("rejects a link replacement that has no operation id before it rotates the token", async () => {
    const response = await POST(tokenRequest(), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "idempotency_key_required" });
    expect(mocks.regenerateTokenWithOperation).not.toHaveBeenCalled();
  });

  it("keeps a member denial ahead of the operation-id check", async () => {
    mocks.guardAdmin.mockResolvedValue(NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }));

    const response = await POST(tokenRequest(), context);

    expect(response.status).toBe(403);
    expect(mocks.getRegenerateLinkOperation).not.toHaveBeenCalled();
  });

  it("returns a specific conflict when an invitation is unresolved", async () => {
    mocks.rotated = { kind: "invite_pending" };

    const response = await POST(tokenRequest("rotate-1"), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "invite_pending", error: expect.stringContaining("Resolve the pending invitation") });
    expect(mocks.regenerateTokenWithOperation).toHaveBeenCalledWith("person-id", expect.objectContaining({
      operationId: "rotate-1",
      credentialId: "host:user-1",
      tool: "host_regenerate_link",
    }));
  });

  it("replays the original private link for the same operation id", async () => {
    mocks.previous = { kind: "replayed", token: "same-token" };

    const response = await POST(tokenRequest("rotate-1"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, token: "same-token" });
    expect(mocks.regenerateTokenWithOperation).not.toHaveBeenCalled();
  });

  it("rejects a reused operation id whose person changed", async () => {
    mocks.previous = { kind: "conflict" };

    const response = await POST(tokenRequest("rotate-1"), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "idempotency_key_conflict" });
  });

  it("returns not found when the participant no longer exists", async () => {
    const response = await POST(tokenRequest("rotate-1"), context);

    expect(response.status).toBe(404);
  });

  it("does not return a deleted person's private link", async () => {
    mocks.previous = { kind: "deleted" };

    const response = await POST(tokenRequest("rotate-1"), context);

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body).toMatchObject({ code: "operation_result_unavailable" });
    expect(JSON.stringify(body)).not.toMatch(/private link token|kqa_/);
  });
});

describe("participant invitation delivery route", () => {
  it("returns a conflict when the checked attempt was replaced before its result was saved", async () => {
    const response = await POST(
      new Request("https://survee.example/api/admin/people/person-id/delivery", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ pid: "person-id", action: "delivery" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "superseded", error: "The invite changed." });
  });
});
