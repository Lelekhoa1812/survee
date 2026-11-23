import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  exchanged: { ok: true as const, access: "access-token", refresh: "refresh-token", expiresIn: 3600 },
  rotated: { access: "rotated-access", refresh: "rotated-refresh", expiresIn: 3600 },
}));

vi.mock("@/lib/mcp/oauth", () => ({
  exchangeCode: vi.fn(async () => state.exchanged),
  tokenResponse: (access: string, refresh: string, expiresIn: number) => ({ access_token: access, token_type: "Bearer", expires_in: expiresIn, refresh_token: refresh }),
}));
vi.mock("@/lib/repo/keys", () => ({ rotateOAuthKey: vi.fn(async () => state.rotated) }));

import { POST } from "../src/app/oauth/token/route";
import { exchangeCode } from "@/lib/mcp/oauth";
import { rotateOAuthKey } from "@/lib/repo/keys";

function post(body: string, contentType = "application/x-www-form-urlencoded", extraHeaders: Record<string, string> = {}) {
  return POST(new Request("https://kqa.example.com/oauth/token", {
    method: "POST",
    headers: { "content-type": contentType, ...extraHeaders },
    body,
  }));
}

describe("OAuth token route request bounds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects oversized declared bodies before parsing or exchanging", async () => {
    const response = await post("grant_type=authorization_code", "application/x-www-form-urlencoded", {
      "content-length": String(16 * 1024 + 1),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(rotateOAuthKey).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed bodies without a content length", async () => {
    const response = await post("grant_type=refresh_token&refresh_token=" + "x".repeat(16 * 1024));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(rotateOAuthKey).not.toHaveBeenCalled();
  });

  it("rejects unsupported content types", async () => {
    const response = await post("grant_type=refresh_token&refresh_token=secret", "text/plain");

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({ error: "unsupported_media_type" });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(rotateOAuthKey).not.toHaveBeenCalled();
  });

  it("accepts valid form encoded token requests", async () => {
    const response = await post(new URLSearchParams({
      grant_type: "authorization_code",
      code: "auth-code",
      client_id: "client-id",
      redirect_uri: "https://client.example/callback",
      code_verifier: "verifier",
    }).toString());

    expect(response.status).toBe(200);
    expect(exchangeCode).toHaveBeenCalledWith({ code: "auth-code", clientId: "client-id", redirectUri: "https://client.example/callback", verifier: "verifier" });
  });

  it("continues to accept valid JSON token requests", async () => {
    const response = await post(JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: "refresh-secret",
    }), "application/json; charset=utf-8");

    expect(response.status).toBe(200);
    expect(rotateOAuthKey).toHaveBeenCalledWith("refresh-secret");
    await expect(response.json()).resolves.toMatchObject({ access_token: "rotated-access", refresh_token: "rotated-refresh" });
  });
});
