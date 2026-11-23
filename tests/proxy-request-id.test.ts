import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifySession } = vi.hoisted(() => ({ verifySession: vi.fn(() => null) }));
vi.mock("../src/lib/auth", () => ({ SESSION_COOKIE: "kqa_session", verifySession }));

import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

describe("admin API proxy responses", () => {
  beforeEach(() => verifySession.mockReset().mockReturnValue(null));

  it("returns a safe request ID with pre-route unauthenticated API responses", async () => {
    const response = proxy(new NextRequest("https://kqa.example/api/admin/keys"));
    expect(response.status).toBe(401);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await response.json()).toMatchObject({ ok: false, requestId });
  });
});
