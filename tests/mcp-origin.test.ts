import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpOriginError, withMcpCors } from "../src/lib/mcp/origin";

function request(origin?: string): Request {
  return new Request("https://kqa.example/api/mcp", {
    headers: origin === undefined ? {} : { origin },
  });
}

describe("MCP Origin validation", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KQA_PUBLIC_URL", "https://kqa.example/app");
    vi.stubEnv("KQA_MCP_ALLOWED_ORIGINS", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("allows server-to-server requests without an Origin header", () => {
    expect(mcpOriginError(request())).toBeNull();
  });

  it("allows the configured application origin", () => {
    expect(mcpOriginError(request("https://kqa.example"))).toBeNull();
  });

  it("allows explicitly configured browser origins", () => {
    vi.stubEnv("KQA_MCP_ALLOWED_ORIGINS", "https://client.example, http://localhost:3000");
    expect(mcpOriginError(request("https://client.example"))).toBeNull();
    expect(mcpOriginError(request("http://localhost:3000"))).toBeNull();
  });

  it("adds exact-origin CORS headers only for configured origins", () => {
    const trusted = withMcpCors(request("https://kqa.example"), new Response("ok", { headers: { Vary: "Accept-Encoding" } }));
    expect(trusted.headers.get("access-control-allow-origin")).toBe("https://kqa.example");
    expect(trusted.headers.get("access-control-expose-headers")).toBe("WWW-Authenticate, x-request-id");
    expect(trusted.headers.get("vary")).toContain("Origin");

    const untrusted = withMcpCors(request("https://evil.example"), new Response("ok"));
    expect(untrusted.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    "null",
    "https://evil.example",
    "https://kqa.example.attacker.invalid",
    "https://kqa.example/path",
    "https://user@kqa.example",
  ])("rejects untrusted or non-serialized origin %s", (origin) => {
    const response = mcpOriginError(request(origin));
    expect(response?.status).toBe(403);
  });

  it("does not accept allowlist entries containing paths", () => {
    vi.stubEnv("KQA_MCP_ALLOWED_ORIGINS", "https://client.example/path");
    expect(mcpOriginError(request("https://client.example"))?.status).toBe(403);
  });
});
