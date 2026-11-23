import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";
process.env.KQA_MCP_TOKEN = "t".repeat(43);

interface Client { clientId: string; name: string; redirectUris: string[]; createdAt: Date }
interface Code { _id: { toHexString(): string }; hash: string; tenantId: string; userId: { toHexString(): string }; clientId: string; redirectUri: string; challenge: string; email: string; capabilities?: string[]; expiresAt: Date }
interface Key { _id: { toHexString(): string }; hash: string; refreshHash?: string; name: string; revokedAt?: Date; expiresAt?: Date; prefix: string; suffix: string; createdAt: Date; createdBy: string; oauthClientId?: string; oauthUserId?: { toHexString(): string }; note?: string; capabilities?: string[] }
type ExistenceCondition = { $exists: boolean };
type DateCondition = Date | ExistenceCondition | { $eq: Date; $gt: Date };

const clients: Client[] = [];
const codes: Code[] = [];
const keys: Key[] = [];
let axionActive = true;
let memberActive = true;
let membershipRole: "owner" | "admin" | "member" = "owner";

vi.mock("../src/lib/db", () => ({
  col: {
    tenants: async () => ({
      findOne: async (query: { _id: string; status: string }) => axionActive && query._id === "axion" && query.status === "active" ? { _id: "axion" } : null,
    }),
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
          if (query.expiresAt && !(query.expiresAt instanceof Date) && "$eq" in query.expiresAt) {
            if (entry.expiresAt?.getTime() !== query.expiresAt.$eq.getTime() || entry.expiresAt.getTime() <= query.expiresAt.$gt.getTime()) return false;
          }
          if (query.expiresAt && !(query.expiresAt instanceof Date) && "$exists" in query.expiresAt && query.expiresAt.$exists === false && entry.expiresAt !== undefined) return false;
          return true;
        });
        if (!item || !update.$set) return { matchedCount: 0 };
        Object.assign(item, update.$set);
        return { matchedCount: 1 };
      },
    }),
    users: async () => ({
      findOne: async (query: { email?: string }) => query.email === "admin@axiob.local" ? { _id: { toHexString: () => "000000000000000000000001" } } : null,
    }),
    memberships: async () => ({
      findOne: async (query: { tenantId: string; userId?: { toHexString(): string } }) => {
        const id = query.userId?.toHexString();
        return memberActive && query.tenantId === "axion" && id === "000000000000000000000001" ? { role: membershipRole } : null;
      },
    }),
  },
}));

import { allowedRedirect, authorizationServerMetadata, exchangeCode, issueCode, OAUTH_SCOPE, protectedResourceMetadata, registerClient, s256, tokenResponse, wwwAuthenticate } from "../src/lib/mcp/oauth";
import { DEFAULT_MCP_CAPABILITIES, type McpCapability } from "../src/lib/mcp/capabilities";
import { listToolDefs, dispatchTool } from "../src/lib/mcp/tools";
import { authenticateApiKey, authenticateApiKeyAccess, rotateOAuthKey } from "../src/lib/repo/keys";

function issueReadOnlyCode(input: Omit<Parameters<typeof issueCode>[0], "capabilities">): Promise<string> {
  return issueCode({ ...input, capabilities: [...DEFAULT_MCP_CAPABILITIES] });
}

describe("OAuth discovery and PKCE", () => {
  beforeEach(() => {
    clients.splice(0);
    codes.splice(0);
    keys.splice(0);
    axionActive = true;
    memberActive = true;
    membershipRole = "owner";
  });

  it("publishes the documents ChatGPT looks up", () => {
    const origin = "https://kqa.example";
    const resource = protectedResourceMetadata(origin);
    const server = authorizationServerMetadata(origin);
    expect(resource.resource).toBe("https://kqa.example/api/mcp");
    expect(resource.authorization_servers).toEqual([origin]);
    expect(server.issuer).toBe(origin);
    expect(server.code_challenge_methods_supported).toContain("S256");
    expect(resource.scopes_supported).toEqual([OAUTH_SCOPE]);
    expect(server.scopes_supported).toEqual([OAUTH_SCOPE]);
    expect(tokenResponse("access", "refresh", 60).scope).toBe(OAUTH_SCOPE);
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
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge, email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const bad = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier: "wrong-verifier-value-with-enough-length" });
    expect(bad.ok).toBe(false);
    const again = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    expect(again.ok).toBe(false);

    const fresh = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge, email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
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

  it("stores the selected OAuth permissions, enforces them on tools, and preserves them on refresh", async () => {
    const registered = await registerClient({ name: "Analytics client", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "limited-permission-verifier-value-123456";
    const capabilities: McpCapability[] = ["analytics:read"];
    const code = await issueCode({
      clientId: registered.clientId,
      redirectUri: "https://chatgpt.com/callback",
      challenge: s256(verifier),
      email: "admin@axiob.local",
      tenantId: "axion",
      userId: "000000000000000000000001",
      capabilities,
    });

    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");
    expect(keys[0].capabilities).toEqual(capabilities);
    expect(keys[0].oauthUserId?.toHexString()).toBe("000000000000000000000001");
    const access = await authenticateApiKeyAccess(exchanged.access);
    expect(access).toEqual({ tenantId: "axion", auditActor: { kind: "oauth", id: keys[0]._id.toHexString(), name: "Analytics client" }, capabilities });
    const names = listToolDefs(access?.capabilities).map(({ name }) => name);
    expect(names).toContain("get_analytics_guidance");
    expect(names).toContain("analyze_answers");
    expect(names).not.toContain("get_answers");
    expect(names).not.toContain("list_interviews");
    expect((await dispatchTool("get_analytics_guidance", {}, access?.capabilities)).isError).toBe(false);
    expect((await dispatchTool("get_answers", { interviewId: "a".repeat(24) }, access?.capabilities)).isError).toBe(true);

    const rotated = await rotateOAuthKey(exchanged.refresh);
    expect(rotated).not.toBeNull();
    expect(keys[0].capabilities).toEqual(capabilities);
    expect(await authenticateApiKeyAccess(rotated!.access)).toEqual({ tenantId: "axion", auditActor: { kind: "oauth", id: keys[0]._id.toHexString(), name: "Analytics client" }, capabilities });
  });

  it("reduces an existing OAuth connection to read-only tools when its user becomes a member", async () => {
    const registered = await registerClient({ name: "Member role change", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "member-role-change-verifier-value-123456";
    const capabilities: McpCapability[] = ["interviews:read", "analytics:read", "assets:read", "respondents:read", "respondents:manage", "interviews:delete"];
    const code = await issueCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001", capabilities });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");

    membershipRole = "member";
    const access = await authenticateApiKeyAccess(exchanged.access);

    expect(access?.capabilities).toEqual(["interviews:read", "analytics:read", "assets:read"]);
    const names = listToolDefs(access?.capabilities).map(({ name }) => name);
    expect(names).toContain("list_interviews");
    expect(names).toContain("analyze_answers");
    expect(names).not.toContain("get_answers");
    expect(names).not.toContain("delete_interview");
    expect(await rotateOAuthKey(exchanged.refresh)).not.toBeNull();
  });

  it("permanently disables an OAuth connection when its user leaves and later rejoins", async () => {
    const registered = await registerClient({ name: "Removed member", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "removed-member-oauth-verifier-value-123456";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");

    memberActive = false;
    expect(await authenticateApiKeyAccess(exchanged.access)).toBeNull();
    expect(await rotateOAuthKey(exchanged.refresh)).toBeNull();

    // Membership checks alone would allow these credentials to revive. Member
    // removal now also sets revokedAt transactionally, which survives rejoining.
    keys[0].revokedAt = new Date();
    memberActive = true;
    expect(await authenticateApiKeyAccess(exchanged.access)).toBeNull();
    expect(await rotateOAuthKey(exchanged.refresh)).toBeNull();
  });

  it("rejects OAuth access and refresh when the tenant is suspended", async () => {
    const registered = await registerClient({ name: "Suspension check", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "suspended-tenant-oauth-verifier-value-123456";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");

    axionActive = false;
    expect(await authenticateApiKeyAccess(exchanged.access)).toBeNull();
    expect(await rotateOAuthKey(exchanged.refresh)).toBeNull();
    expect(keys).toHaveLength(1);
  });

  it("uses read-only defaults for a short-lived code issued before capability consent", async () => {
    const registered = await registerClient({ name: "Older client", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "legacy-capability-code-verifier-value-1234";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    delete codes[0].capabilities;

    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });

    expect(exchanged.ok).toBe(true);
    expect(keys[0].capabilities).toEqual(DEFAULT_MCP_CAPABILITIES);
  });

  it("rejects a code whose stored permission grant is invalid", async () => {
    const registered = await registerClient({ name: "Tampered client", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "invalid-capability-code-verifier-value-123";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    codes[0].capabilities = ["root:all"];

    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });

    expect(exchanged).toEqual({ ok: false, error: "invalid_grant" });
    expect(keys).toHaveLength(0);
  });

  it("allows only one concurrent exchange of an authorization code", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "parallel-code-verifier-value-1234567890";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const input = { code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier };

    const results = await Promise.all([exchangeCode(input), exchangeCode(input)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(keys).toHaveLength(1);
  });

  it("allows only one concurrent refresh-token rotation", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "parallel-refresh-verifier-value-123456";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
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

  it("preserves an owner-shortened expiry when rotating an OAuth credential", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "owner-shortened-expiry-verifier-value-123456";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");
    const shortenedExpiry = new Date(Date.now() + 3 * 60 * 60 * 1000);
    keys[0].expiresAt = shortenedExpiry;

    const rotated = await rotateOAuthKey(exchanged.refresh);

    expect(rotated).not.toBeNull();
    expect(keys[0].expiresAt?.getTime()).toBe(shortenedExpiry.getTime());
    expect(rotated?.expiresIn).toBeGreaterThanOrEqual(3 * 60 * 60 - 1);
    expect(rotated?.expiresIn).toBeLessThanOrEqual(3 * 60 * 60);
  });

  it("returns the remaining lifetime when refreshing a near-expiry OAuth credential", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "near-expiry-refresh-verifier-value-12345";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");
    const nearExpiry = new Date(Date.now() + 5_000);
    keys[0].expiresAt = nearExpiry;

    const rotated = await rotateOAuthKey(exchanged.refresh);

    expect(rotated).not.toBeNull();
    expect(keys[0].expiresAt?.getTime()).toBe(nearExpiry.getTime());
    expect(rotated?.expiresIn).toBeGreaterThanOrEqual(0);
    expect(rotated?.expiresIn).toBeLessThanOrEqual(5);
  });

  it("preserves the original expiry for a normal unexpired OAuth credential", async () => {
    const registered = await registerClient({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/callback"] });
    if (!registered.ok) throw new Error("Client registration failed.");
    const verifier = "normal-expiry-refresh-verifier-value-12345";
    const code = await issueReadOnlyCode({ clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", challenge: s256(verifier), email: "admin@axiob.local", tenantId: "axion", userId: "000000000000000000000001" });
    const exchanged = await exchangeCode({ code, clientId: registered.clientId, redirectUri: "https://chatgpt.com/callback", verifier });
    if (!exchanged.ok) throw new Error("Authorization code exchange failed.");
    const originalExpiry = keys[0].expiresAt?.getTime();

    const rotated = await rotateOAuthKey(exchanged.refresh);

    expect(rotated).not.toBeNull();
    expect(keys[0].expiresAt?.getTime()).toBe(originalExpiry);
    expect(rotated?.expiresIn).toBeGreaterThanOrEqual(Math.floor(30 * 24 * 60 * 60) - 1);
    expect(rotated?.expiresIn).toBeLessThanOrEqual(Math.floor(30 * 24 * 60 * 60));
  });
});
