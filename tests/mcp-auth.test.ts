import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";
process.env.KQA_MCP_TOKEN = "t".repeat(43);

const { touch, dispatch, tenant } = vi.hoisted(() => ({ touch: vi.fn(), dispatch: vi.fn(), tenant: { active: true } }));

vi.mock("../src/lib/db", () => {
  const deny = () => {
    touch();
    return Promise.reject(new Error("mongo should not be touched"));
  };
  return {
    db: deny,
    col: new Proxy({}, {
      get: (_target, key) => key === "tenants"
        ? async () => ({ findOne: async (query: { _id: string; status: string }) => { touch(); return tenant.active && query._id === "axion" && query.status === "active" ? { _id: "axion" } : null; } })
        : deny,
    }),
  };
});

vi.mock("../src/lib/mcp/tools", () => ({
  dispatchTool: dispatch,
  listToolDefs: vi.fn(() => []),
}));

import { handleMcp } from "../src/lib/mcp/http";
import { authorizeMcp } from "../src/lib/mcp/auth";

function post(headers: Record<string, string>, url = "https://kqa.example/api/mcp") {
  return handleMcp(new Request(url, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
}

function postBody(headers: Record<string, string>, body: unknown) {
  return handleMcp(new Request("https://kqa.example/api/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

describe("MCP auth", () => {
  beforeEach(() => {
    tenant.active = true;
    touch.mockClear();
    dispatch.mockClear();
  });

  it("rejects a missing token, a wrong token, a query token, and the admin cookie without touching Mongo", async () => {
    const missing = await post({});
    const wrong = await post({ authorization: "Bearer not-the-token" });
    const query = await post({ authorization: `Bearer ${process.env.KQA_MCP_TOKEN}` }, "https://kqa.example/api/mcp?token=abc");
    const cookie = await post({ cookie: "kqa_admin=session" });
    for (const res of [missing, wrong, query, cookie]) expect(res.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("oauth-protected-resource");
    expect(touch).not.toHaveBeenCalled();
  });

  it("looks up a long unknown bearer and still returns 401", async () => {
    touch.mockClear();
    const res = await post({ authorization: `Bearer ${"x".repeat(40)}` });
    expect(res.status).toBe(401);
    expect(touch).toHaveBeenCalled();
  });

  it("binds the server token to the fixed active Axion principal", async () => {
    touch.mockClear();
    const auth = await authorizeMcp(new Request("https://kqa.example/api/mcp", { headers: { authorization: `Bearer ${process.env.KQA_MCP_TOKEN}` } }));
    expect(auth).toMatchObject({ ok: true, principal: { tenantId: "axion", role: "service", source: "service_token" } });
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("rejects the server token when Axion is suspended", async () => {
    tenant.active = false;
    const auth = await authorizeMcp(new Request("https://kqa.example/api/mcp", { headers: { authorization: `Bearer ${process.env.KQA_MCP_TOKEN}` } }));
    expect(auth).toEqual({ ok: false, status: 401, error: "Unauthorized." });
  });

  it("rejects JSON-RPC batches before dispatch", async () => {
    dispatch.mockClear();
    const res = await postBody({ authorization: `Bearer ${process.env.KQA_MCP_TOKEN}` }, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_interview", arguments: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_interview", arguments: {} } },
    ]);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
