import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member" as "owner" | "admin" | "member" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "signed-session" }) }),
  headers: async () => new Headers({ origin: "https://kqa.test", host: "kqa.test" }),
}));
vi.mock("../src/lib/auth", () => ({
  SESSION_COOKIE: "kqa_admin",
  verifySession: () => ({ userId: "000000000000000000000001", tenantId: "tenant-1", email: "member@example.test", role: state.role, authVersion: 0, sid: "session-1", exp: Math.floor(Date.now() / 1000) + 3600 }),
}));
vi.mock("../src/lib/repo", () => ({ isSessionRevoked: async () => false }));
vi.mock("../src/lib/repo/accounts", () => ({
  loadAccountPrincipal: async () => ({ userId: "000000000000000000000001", tenantId: "tenant-1", email: "member@example.test", role: state.role, tenantName: "Workspace", emailVerified: true, legacyBootstrap: false, authVersion: 0 }),
}));
vi.mock("../src/lib/repo/keys", () => ({
  createApiKey: vi.fn(async () => ({ ok: true, key: { id: "key-1" }, secret: "kqa_test" })),
  deleteApiKey: vi.fn(async () => ({ ok: true })),
  generateKeySecret: () => "kqa_generated",
  listApiKeys: vi.fn(async () => []),
  updateApiKey: vi.fn(async () => ({ ok: true, key: { id: "key-1" } })),
}));

import { GET, POST } from "../src/app/api/admin/keys/route";
import { DELETE, PATCH } from "../src/app/api/admin/keys/[id]/route";
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey } from "../src/lib/repo/keys";

describe("MCP key admin role guard", () => {
  beforeEach(() => {
    state.role = "member";
    vi.clearAllMocks();
  });

  it("blocks members from listing, creating, editing, or deleting workspace keys", async () => {
    const create = new Request("https://kqa.test/api/admin/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Agent" }),
    });
    const edit = new Request("https://kqa.test/api/admin/keys/key-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revoked: true }),
    });

    const responses = await Promise.all([
      GET(),
      POST(create),
      PATCH(edit, { params: Promise.resolve({ id: "key-1" }) }),
      DELETE(new Request("https://kqa.test/api/admin/keys/key-1", { method: "DELETE" }), { params: Promise.resolve({ id: "key-1" }) }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(listApiKeys).not.toHaveBeenCalled();
    expect(createApiKey).not.toHaveBeenCalled();
    expect(updateApiKey).not.toHaveBeenCalled();
    expect(deleteApiKey).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("allows %s accounts to read the key list", async (role) => {
    state.role = role;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(listApiKeys).toHaveBeenCalledOnce();
  });
});
