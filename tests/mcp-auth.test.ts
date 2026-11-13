import { describe, expect, it, vi } from "vitest";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";
process.env.KQA_MCP_TOKEN = "t".repeat(43);

const { touch } = vi.hoisted(() => ({ touch: vi.fn() }));

vi.mock("../src/lib/db", () => {
  const deny = () => {
    touch();
    return Promise.reject(new Error("mongo should not be touched"));
  };
  return { db: deny, col: new Proxy({}, { get: () => deny }) };
});

import { handleMcp } from "../src/lib/mcp/http";

function post(headers: Record<string, string>, url = "https://kqa.example/api/mcp") {
  return handleMcp(new Request(url, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
}

describe("MCP auth", () => {
  it("rejects a missing token, a wrong token, a query token, and the admin cookie without touching Mongo", async () => {
    const missing = await post({});
    const wrong = await post({ authorization: "Bearer not-the-token" });
    const query = await post({ authorization: `Bearer ${process.env.KQA_MCP_TOKEN}` }, "https://kqa.example/api/mcp?token=abc");
    const cookie = await post({ cookie: "kqa_admin=session" });
    for (const res of [missing, wrong, query, cookie]) expect(res.status).toBe(401);
    expect(touch).not.toHaveBeenCalled();
  });
});
