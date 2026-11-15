import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";
process.env.KQA_MCP_TOKEN = "t".repeat(43);

interface Client { clientId: string; name: string; redirectUris: string[]; createdAt: Date }
interface Code { _id: { toHexString(): string }; hash: string; clientId: string; redirectUri: string; challenge: string; email: string; expiresAt: Date }
interface Key { _id: { toHexString(): string }; hash: string; refreshHash?: string; name: string; revokedAt?: Date; expiresAt?: Date; prefix: string; suffix: string; createdAt: Date; createdBy: string; oauthClientId?: string; note?: string }
type ExistenceCondition = { $exists: boolean };
type DateCondition = Date | ExistenceCondition;

const clients: Client[] = [];
const codes: Code[] = [];
const keys: Key[] = [];

vi.mock("../src/lib/db", () => ({
  col: {
    oauthClients: async () => ({
      insertOne: async (doc: Client) => { clients.push(doc); },
      findOne: async (query: { clientId: string }) => clients.find((item) => item.clientId === query.clientId) ?? null,
    }),
    oauthCodes: async () => ({
      insertOne: async (doc: Code) => { codes.push(doc); },
      findOne: async (query: { hash: string }) => codes.find((item) => item.hash === query.hash) ?? null,
      deleteOne: async (query: { _id: { toHexString(): string }; hash: string; expiresAt: { $gt: Date } }) => {
        const index = codes.findIndex((item) => item._id.toHexString() === query._id.toHexString()
          && item.hash === query.hash
          && item.expiresAt.getTime() > query.expiresAt.$gt.getTime());
        if (index >= 0) codes.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
    }),
    apiKeys: async () => ({
      insertOne: async (doc: Key) => { keys.push(doc); return { insertedId: doc._id }; },
      findOne: async (query: { hash?: string; refreshHash?: string }) => keys.find((item) => query.hash ? item.hash === query.hash : item.refreshHash === query.refreshHash) ?? null,
      updateOne: async (query: { _id?: { toHexString(): string }; hash?: string; refreshHash?: string; revokedAt?: ExistenceCondition; expiresAt?: DateCondition }, update: { $set?: Partial<Key> }) => {
        const item = keys.find((entry) => {
          if (query._id && entry._id.toHexString() !== query._id.toHexString()) return false;
          if (query.hash && entry.hash !== query.hash) return false;
          if (query.refreshHash && entry.refreshHash !== query.refreshHash) return false;
          if (query.revokedAt?.$exists === false && entry.revokedAt !== undefined) return false;
          if (query.expiresAt instanceof Date && entry.expiresAt?.getTime() !== query.expiresAt.getTime()) return false;
          if (query.expiresAt && !(query.expiresAt instanceof Date) && query.expiresAt.$exists === false && entry.expiresAt !== undefined) return false;
          return true;
        });
        if (!item || !update.$set) return { matchedCount: 0 };
        Object.assign(item, update.$set);
        return { matchedCount: 1 };
      },
    }),
  },
}));

import { allowedRedirect, authorizationServerMetadata, exchangeCode, issueCode, protectedResourceMetadata, registerClient, s256, wwwAuthenticate } from "../src/lib/mcp/oauth";
import { authenticateApiKey, rotateOAuthKey } from "../src/lib/repo/keys";

describe("OAuth discovery and PKCE", () => {
  beforeEach(() => {
    clients.splice(0);
    codes.splice(0);
    keys.splice(0);
  });

  it("publishes the documents ChatGPT looks up", () => {
    const origin = "https://kqa.example";
    const resource = protectedResourceMetadata(origin);
    const server = authorizationServerMetadata(origin);
    expect(resource.resource).toBe("https://kqa.example/api/mcp");
    expect(resource.authorization_servers).toEqual([origin]);
    expect(server.issuer).toBe(origin);
    expect(server.code_challenge_methods_supported).toContain("S256");
    expect(server.registration_endpoint).toBe("https://kqa.example/oauth/register");
    expect(server.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(wwwAuthenticate(origin)).toContain("resource_metadata=\"https://kqa.example/.well-known/oauth-protected-resource/api/mcp\"");
  });

  it("rejects a redirect that is not https or localhost", () => {
    expect(allowedRedirect("https://chatgpt.com/connector/oauth/callback")).toBe(true);
    expect(allowedRedirect("http://localhost:3000/callback")).toBe(true);
    expect(allowedRedirect("http://evil.example/callback")).toBe(false);
    expect(allowedRedirect("https://chatgpt.com/callback#token")).toBe(false);
  });

  it("registers a client, exchanges a PKCE code once, and accepts the access token", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const refused = await registerClient({ redirectUris: ["http://evil.example/callback"] });
    expect(refused.ok).toBe(false);

    const verifier = "a".repeat(48);
    const challenge = s256(verifier);
    const code = await issueCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge, email: "admin@axion.local" });
    const bad = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier: "wrong-verifier-value-with-enough-length" });
    expect(bad.ok).toBe(false);
    const again = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    expect(again.ok).toBe(false);

    const fresh = await issueCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge, email: "admin@axion.local" });
    const good = await exchangeCode({ code: fresh, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(await authenticateApiKey(good.access)).toBe(true);
    const rotated = await rotateOAuthKey(good.refresh);
    expect(rotated).not.toBeNull();
    if (!rotated) return;
    expect(await authenticateApiKey(good.access)).toBe(false);
    expect(await authenticateApiKey(rotated.access)).toBe(true);
    expect(await rotateOAuthKey(good.refresh)).toBeNull();
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });

  it("allows only one concurrent exchange of an authorization code", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "parallel-code-verifier-value-1234567890";
    const code = await issueCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axion.local" });
    const input = { code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier };

    const results = await Promise.all([exchangeCode(input), exchangeCode(input)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(keys).toHaveLength(1);
  });

  it("allows only one concurrent refresh-token rotation", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "parallel-refresh-verifier-value-123456";
    const code = await issueCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axion.local" });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");

    const rotations = await Promise.all([rotateOAuthKey(exchanged.refresh), rotateOAuthKey(exchanged.refresh)]);
    const successful = rotations.filter((rotation) => rotation !== null);

    expect(successful).toHaveLength(1);
    expect(keys).toHaveLength(1);
    expect(await authenticateApiKey(exchanged.access)).toBe(false);
    if (successful[0]) expect(await authenticateApiKey(successful[0].access)).toBe(true);
    expect(await rotateOAuthKey(exchanged.refresh)).toBeNull();
  });
});
