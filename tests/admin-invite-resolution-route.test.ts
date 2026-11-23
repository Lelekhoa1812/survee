import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guardAdmin: vi.fn(async () => null as unknown),
  adminSession: vi.fn(async () => ({ userId: "aaaaaaaaaaaaaaaaaaaaaaaa" })),
  resolveInviteAttempt: vi.fn(async () => "resolved" as string),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status }),
  guardAdmin: mocks.guardAdmin,
  adminSession: mocks.adminSession,
  json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
  readJson: async (request: Request) => ({ ok: true, data: await request.json() }),
  withServerErrors: (_route: string, handler: (...args: never[]) => Promise<NextResponse>) => handler,
}));
vi.mock("@/lib/repo", () => ({ resolveInviteAttempt: mocks.resolveInviteAttempt }));

import { POST } from "../src/app/api/admin/people/[pid]/invite-resolution/route";

const context = { params: Promise.resolve({ pid: "bbbbbbbbbbbbbbbbbbbbbbbb" }) };
const request = (body: unknown) => new Request("https://survee.example/api/admin/people/person/invite-resolution", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("invite resolution route", () => {
  beforeEach(() => {
    mocks.guardAdmin.mockReset().mockResolvedValue(null);
    mocks.adminSession.mockReset().mockResolvedValue({ userId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    mocks.resolveInviteAttempt.mockReset().mockResolvedValue("resolved");
  });

  it("requires host authorization before writing the exact disposition", async () => {
    mocks.guardAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }));
    const response = await POST(request({ attemptId: "cccccccccccccccccccccccc", purpose: "email_change", reason: "Correct address" }), context);
    expect(response.status).toBe(403);
    expect(mocks.guardAdmin).toHaveBeenCalledWith({ mutating: true, roles: ["owner", "admin"] });
    expect(mocks.resolveInviteAttempt).not.toHaveBeenCalled();
  });

  it("records the signed-in host and returns stale/already-resolved conflicts", async () => {
    const response = await POST(request({ attemptId: "cccccccccccccccccccccccc", purpose: "token_rotation", reason: "Prior address was wrong" }), context);
    expect(response.status).toBe(200);
    expect(mocks.resolveInviteAttempt).toHaveBeenCalledWith({ participantId: "bbbbbbbbbbbbbbbbbbbbbbbb", attemptId: "cccccccccccccccccccccccc", purpose: "token_rotation", reason: "Prior address was wrong", actorId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    mocks.resolveInviteAttempt.mockResolvedValueOnce("stale");
    expect((await POST(request({ attemptId: "cccccccccccccccccccccccc", purpose: "token_rotation", reason: "Prior address was wrong" }), context)).status).toBe(409);
    mocks.resolveInviteAttempt.mockResolvedValueOnce("already_resolved");
    expect((await POST(request({ attemptId: "cccccccccccccccccccccccc", purpose: "token_rotation", reason: "Prior address was wrong" }), context)).status).toBe(409);
  });
});
