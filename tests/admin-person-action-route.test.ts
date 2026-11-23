import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: null as string | null | "invite_pending",
  guardAdmin: vi.fn(async () => null),
  regenerateToken: vi.fn(async () => mocks.token),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status }),
  guardAdmin: mocks.guardAdmin,
  json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
  readJson: vi.fn(),
  withServerErrors: (_route: string, handler: (...args: never[]) => Promise<NextResponse>) => handler,
}));
vi.mock("@/lib/mail/delivery", () => ({ checkInviteDelivery: vi.fn() }));
vi.mock("@/lib/mail/invite", () => ({ sendInvite: vi.fn() }));
vi.mock("@/lib/repo", () => ({ regenerateToken: mocks.regenerateToken, reopenParticipant: vi.fn() }));

import { POST } from "../src/app/api/admin/people/[pid]/[action]/route";

const context = { params: Promise.resolve({ pid: "person-id", action: "token" }) };

describe("participant private-link rotation route", () => {
  beforeEach(() => {
    mocks.token = null;
    mocks.guardAdmin.mockReset().mockResolvedValue(null);
    mocks.regenerateToken.mockReset().mockImplementation(async () => mocks.token);
  });

  it("returns a specific conflict when an invitation is unresolved", async () => {
    mocks.token = "invite_pending";

    const response = await POST(new Request("https://survee.example/api/admin/people/person-id/token", { method: "POST" }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "invite_pending", error: expect.stringContaining("Resolve the pending invitation") });
  });

  it("returns not found when the participant no longer exists", async () => {
    const response = await POST(new Request("https://survee.example/api/admin/people/person-id/token", { method: "POST" }), context);

    expect(response.status).toBe(404);
  });
});
