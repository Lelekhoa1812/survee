import { describe, expect, it, vi } from "vitest";

const { authorizeMcp } = vi.hoisted(() => ({
  authorizeMcp: vi.fn(async () => ({
    ok: true as const,
    principal: { tenantId: "axion", role: "service" as const, source: "service_token" as const },
  })),
}));

vi.mock("../src/lib/mcp/auth", () => ({ authorizeMcp }));

import { handleMcp } from "../src/lib/mcp/http";

async function initialize(protocolVersion: unknown) {
  const response = await handleMcp(new Request("https://kqa.example/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }),
  }));
  return { status: response.status, body: await response.json() as { result?: { protocolVersion?: string } } };
}

describe("MCP protocol version negotiation", () => {
  it("echoes the supported protocol version when the client requests it", async () => {
    const response = await initialize("2025-06-18");
    expect(response.status).toBe(200);
    expect(response.body.result?.protocolVersion).toBe("2025-06-18");
  });

  it("returns the supported version for an unsupported date-shaped request", async () => {
    const response = await initialize("2099-12-31");
    expect(response.status).toBe(200);
    expect(response.body.result?.protocolVersion).toBe("2025-06-18");
  });

  it("returns the supported version when the requested version is malformed", async () => {
    const response = await initialize("not-a-protocol-version");
    expect(response.status).toBe(200);
    expect(response.body.result?.protocolVersion).toBe("2025-06-18");
  });
});
