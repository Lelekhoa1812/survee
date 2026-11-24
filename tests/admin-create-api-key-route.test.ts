import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "user-1", email: "owner@example.test" },
  create: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  adminSession: async () => state.session,
  fail: (status: number, error: string, extra?: Record<string, unknown>) => Response.json({ ok: false, error, ...extra }, { status }),
  json: (data: unknown, status = 200) => Response.json(data, { status }),
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  readJson: async (req: Request) => { try { return { ok: true, data: await req.json() }; } catch { return { ok: false, res: Response.json({ ok: false }, { status: 400 }) }; } },
}));
vi.mock("@/lib/repo/keys", () => ({ createApiKeyWithOperation: state.create, hashKey: (secret: string) => `hashed:${secret}`, listApiKeys: vi.fn() }));

import { POST } from "../src/app/api/admin/keys/route";

const secret = `kqa_${"x".repeat(43)}`;
const body = { name: "Reader", note: "test", value: secret, capabilities: ["interviews:read"] };
function request(operationId = "key-create-1", data = body) {
  return new Request("https://kqa.test/api/admin/keys", { method: "POST", headers: { "content-type": "application/json", ...(operationId ? { "Idempotency-Key": operationId } : {}) }, body: JSON.stringify(data) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
  state.session = { userId: "user-1", email: "owner@example.test" };
  state.create.mockResolvedValue({ kind: "created", key: { id: "key-1", name: "Reader" } });
});

describe("host API key creation route", () => {
  it("requires operation ID and client supplied secret, and binds a secret-hash digest to the host user", async () => {
    expect((await POST(request(""))).status).toBe(400);
    expect((await POST(request("key-1", { ...body, value: "" }))).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();

    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ secret, key: { id: "key-1" } });
    const [input, operation] = state.create.mock.calls[0];
    expect(input.secret).toBe(secret);
    expect(operation).toMatchObject({ operationId: "key-create-1", credentialId: "host:user-1", argumentDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(operation.argumentDigest).not.toContain(secret);
  });

  it("returns a supplied secret on a same-argument replay and rejects changed arguments", async () => {
    state.create.mockResolvedValue({ kind: "replayed", key: { id: "key-1", name: "Reader" } });
    const replay = await POST(request());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ secret });
    state.create.mockResolvedValue({ kind: "conflict" });
    expect((await POST(request())).status).toBe(409);
  });
});
