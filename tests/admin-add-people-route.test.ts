import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "user-1" },
  existing: null as unknown,
  getOperation: vi.fn(),
  add: vi.fn(),
  getInterview: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  adminSession: async () => state.session,
  fail: (status: number, error: string, extra?: Record<string, unknown>) => Response.json({ ok: false, error, ...extra }, { status }),
  json: (data: unknown, status = 200) => Response.json(data, { status }),
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  readJson: async (req: Request) => {
    try { return { ok: true, data: await req.json() }; }
    catch { return { ok: false, res: Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 }) }; }
  },
}));
vi.mock("@/lib/repo", () => ({
  addParticipantsWithOperation: state.add,
  getAddPeopleOperation: state.getOperation,
  getInterview: state.getInterview,
}));

import { POST } from "../src/app/api/admin/interviews/[id]/people/route";

const people = [{ name: "Ada Lovelace" }];
const created = [{ id: "person-1", name: "Ada Lovelace", token: "private-token" }];
function request(headers: Record<string, string> = { "Idempotency-Key": "add-1" }) {
  return new Request("https://kqa.local/api/admin/interviews/interview-1/people", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ people }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
  state.session = { userId: "user-1" };
  state.getOperation.mockResolvedValue(null);
  state.getInterview.mockResolvedValue({ _id: "interview-1" });
  state.add.mockResolvedValue({ kind: "created", people: created });
});

describe("host add-people idempotency", () => {
  it("requires a key and stores the normalized batch under the host-user scope", async () => {
    const ctx = { params: Promise.resolve({ id: "interview-1" }) };
    expect((await POST(request({}), ctx)).status).toBe(400);
    expect(state.add).not.toHaveBeenCalled();

    const response = await POST(request(), ctx);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ people: created });
    expect(state.add).toHaveBeenCalledWith("interview-1", [{ name: "Ada Lovelace" }], expect.objectContaining({
      operationId: "add-1", credentialId: "host:user-1", tool: "host_add_people", argumentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("replays retained participant links without a second database write", async () => {
    state.getOperation.mockResolvedValue({ kind: "replayed", people: created });
    const response = await POST(request(), { params: Promise.resolve({ id: "interview-1" }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ people: created });
    expect(state.getInterview).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("returns a conflict when a key is reused for another batch", async () => {
    state.getOperation.mockResolvedValue({ kind: "conflict" });
    const response = await POST(request(), { params: Promise.resolve({ id: "interview-1" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "idempotency_key_conflict" });
    expect(state.add).not.toHaveBeenCalled();
  });
});
