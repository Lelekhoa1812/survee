import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "user-1" },
  existing: null as unknown,
  prepared: vi.fn(),
  getOperation: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
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
  createInterviewWithOperation: state.create,
  getCreateInterviewOperation: state.getOperation,
  listInterviews: state.list,
}));
vi.mock("@/lib/survey", () => ({ prepareSurvey: state.prepared }));

import { POST } from "../src/app/api/admin/interviews/route";

const input = { name: "Planning", description: "", mode: "multi", html: "<html>questionnaire</html>", fileName: "survey.html" };
const report = { ok: true, counts: { error: 0 } };
const created = { kind: "created", result: { id: "interview-1", interviewId: "interview-1", report } };

function request(headers: Record<string, string> = { "Idempotency-Key": "create-1" }) {
  return new Request("https://kqa.local/api/admin/interviews", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(input) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
  state.session = { userId: "user-1" };
  state.getOperation.mockResolvedValue(null);
  state.prepared.mockReturnValue({ survey: { manifest: { questions: [] } }, report });
  state.create.mockResolvedValue(created);
});

describe("host interview creation idempotency", () => {
  it("requires a key and stores the mutation under a host-user scope", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();

    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "interview-1", report });
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Planning", mode: "multi" }), expect.objectContaining({
      operationId: "create-1", credentialId: "host:user-1", tool: "host_create_interview", argumentDigest: expect.stringMatching(/^[0-9a-f]{64}$/), report,
    }));
  });

  it("replays before re-running the current questionnaire checker", async () => {
    state.getOperation.mockResolvedValue({ kind: "replayed", result: created.result });
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "interview-1", report });
    expect(state.prepared).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("rejects reusing a key with different effective arguments", async () => {
    state.getOperation.mockResolvedValue({ kind: "conflict" });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "idempotency_key_conflict" });
    expect(state.create).not.toHaveBeenCalled();
  });
});
