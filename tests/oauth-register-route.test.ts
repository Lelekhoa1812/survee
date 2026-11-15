import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rateAllowed: true }));

vi.mock("@/lib/repo", () => ({ consumeRateLimit: vi.fn(async () => state.rateAllowed) }));
vi.mock("@/lib/mcp/oauth", () => ({
  registerClient: vi.fn(async ({ name, redirectUris }: { name?: string; redirectUris: string[] }) => ({
    ok: true,
    clientId: "kqa_test_client",
    name: name ?? "MCP client",
    redirectUris,
  })),
}));

import { POST } from "../src/app/oauth/register/route";
import { consumeRateLimit } from "@/lib/repo";
import { registerClient } from "@/lib/mcp/oauth";

function post(body: string, headers: Record<string, string> = {}) {
  return POST(new Request("https://kqa.example.com/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  }));
}

describe("OAuth dynamic client registration route", () => {
  beforeEach(() => {
    state.rateAllowed = true;
    vi.clearAllMocks();
  });

  it("bounds streamed request bodies before parsing or persistence", async () => {
    const response = await post("{" + " ".repeat(16 * 1024), { "x-vercel-forwarded-for": "192.0.2.4" });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(registerClient).not.toHaveBeenCalled();
  });

  it("rejects malformed client metadata without writing a client", async () => {
    const response = await post(JSON.stringify({ redirect_uris: ["https://client.example/callback", 4] }));

    expect(response.status).toBe(400);
    expect(registerClient).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("limits valid registrations by the trusted client IP", async () => {
    state.rateAllowed = false;

    const response = await post(JSON.stringify({ redirect_uris: ["https://client.example/callback"] }), {
      "x-vercel-forwarded-for": "192.0.2.8, 10.0.0.1",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(consumeRateLimit).toHaveBeenCalledWith("oauth-register-ip:192.0.2.8", 30, 60);
    expect(registerClient).not.toHaveBeenCalled();
  });

  it("registers valid public clients and returns the OAuth metadata", async () => {
    const response = await post(JSON.stringify({
      client_name: "Research app",
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
    }), { "x-real-ip": "192.0.2.9" });

    expect(response.status).toBe(201);
    expect(consumeRateLimit).toHaveBeenCalledWith("oauth-register-ip:192.0.2.9", 30, 60);
    expect(registerClient).toHaveBeenCalledWith({ name: "Research app", redirectUris: ["https://client.example/callback"] });
    await expect(response.json()).resolves.toMatchObject({
      client_id: "kqa_test_client",
      client_name: "Research app",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    });
  });

  it("fails closed when the registration limiter is unavailable", async () => {
    vi.mocked(consumeRateLimit).mockRejectedValue(new Error("database unavailable"));

    const response = await post(JSON.stringify({ redirect_uris: ["https://client.example/callback"] }));

    expect(response.status).toBe(503);
    expect(registerClient).not.toHaveBeenCalled();
  });
});
