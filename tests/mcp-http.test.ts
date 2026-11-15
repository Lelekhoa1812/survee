import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMcp } = vi.hoisted(() => ({
  authorizeMcp: vi.fn(async () => ({
    ok: true as const,
    principal: { tenantId: "axion", role: "service" as const, source: "service_token" as const },
  })),
}));

vi.mock("../src/lib/mcp/auth", () => ({ authorizeMcp }));

import { handleMcp } from "../src/lib/mcp/http";
import { DELETE, GET, OPTIONS } from "../src/app/api/mcp/route";

beforeEach(() => {
  vi.stubEnv("KQA_PUBLIC_URL", "https://kqa.example");
  vi.stubEnv("KQA_MCP_ALLOWED_ORIGINS", "");
  authorizeMcp.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

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

  it("rejects browser origins before authorization on every MCP method", async () => {
    const blockedOrigin = "https://attacker.example";
    const handlers = [
      (req: Request) => handleMcp(req),
      (req: Request) => GET(req),
      (req: Request) => DELETE(req),
      (req: Request) => OPTIONS(req),
    ];

    for (const handler of handlers) {
      authorizeMcp.mockClear();
      const response = await handler(new Request("https://kqa.example/api/mcp", {
        method: "POST",
        headers: { origin: blockedOrigin },
      }));
      expect(response.status).toBe(403);
      expect(authorizeMcp).not.toHaveBeenCalled();
    }
  });

  it("answers trusted browser preflight for POST and rejects unlisted headers", async () => {
    vi.stubEnv("KQA_MCP_ALLOWED_ORIGINS", "https://client.example");
    const allowed = await OPTIONS(new Request("https://kqa.example/api/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
      },
    }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://client.example");
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST");
    expect(allowed.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
    expect(authorizeMcp).not.toHaveBeenCalled();

    const rejected = await OPTIONS(new Request("https://kqa.example/api/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, x-admin-cookie",
      },
    }));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBe("https://client.example");
  });
});
