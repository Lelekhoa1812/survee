import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const configuredTestUri = process.env.MONGODB_TEST_URI?.trim();

function isolatedMongoUri(): { uri: string; dbName: string } {
  if (!configuredTestUri) throw new Error("MONGODB_TEST_URI is required for MongoDB retry integration tests.");
  const parsed = new URL(configuredTestUri);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "mongo"]);
  if (parsed.protocol !== "mongodb:" || !localHosts.has(parsed.hostname)) {
    throw new Error("MONGODB_TEST_URI must point to the local MongoDB replica-set test service.");
  }
  if (!parsed.searchParams.has("replicaSet")) {
    throw new Error("MONGODB_TEST_URI must specify a replicaSet query parameter.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("MONGODB_TEST_URI must not include credentials.");
  }
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error("MONGODB_TEST_URI must not name a database; the test creates its own disposable database.");
  }

  const dbName = `kqa_mcp_retry_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  parsed.pathname = `/${dbName}`;
  return { uri: parsed.toString(), dbName };
}

const integration = configuredTestUri ? describe : describe.skip;

integration("MCP operation retries MongoDB replica-set integration", () => {
  let dbName: string;
  let client!: import("mongodb").MongoClient;
  let mongo!: typeof import("mongodb");
  let dbModule!: typeof import("../src/lib/db");
  let accounts!: typeof import("../src/lib/repo/accounts");
  let repository!: typeof import("../src/lib/repo");
  let mailRepository!: typeof import("../src/lib/repo/mail");
  let workspaceRepository!: typeof import("../src/lib/repo/workspaces");
  let tenantMigration!: typeof import("../src/lib/tenant-migration");
  let campaignDrafts!: typeof import("../src/lib/campaign-drafts");
  let withTenantPrincipal!: typeof import("../src/lib/tenant-context").withTenantPrincipal;
  let interviewId!: import("mongodb").ObjectId;
  let signupTieWinnerId!: import("mongodb").ObjectId;
  let signupMissingDateWinnerId!: import("mongodb").ObjectId;
  const previousEnv = {
    mongodbUri: process.env.MONGODB_URI,
    mongodbDb: process.env.MONGODB_DB,
    axionFallback: process.env.KQA_AXION_LEGACY_TENANT_FALLBACK,
  };

  beforeAll(async () => {
    const isolated = isolatedMongoUri();
    dbName = isolated.dbName;
    // The app's DB module reads these names. The URI comes exclusively from the
    // dedicated, local-only test variable and the DB name is always generated here.
    process.env.MONGODB_URI = isolated.uri;
    process.env.MONGODB_DB = dbName;
    process.env.KQA_AXION_LEGACY_TENANT_FALLBACK = "false";

    mongo = await import("mongodb");
    dbModule = await import("../src/lib/db");
    accounts = await import("../src/lib/repo/accounts");
    repository = await import("../src/lib/repo");
    mailRepository = await import("../src/lib/repo/mail");
    workspaceRepository = await import("../src/lib/repo/workspaces");
    tenantMigration = await import("../src/lib/tenant-migration");
    campaignDrafts = await import("../src/lib/campaign-drafts");
    ({ withTenantPrincipal } = await import("../src/lib/tenant-context"));
    client = await new mongo.MongoClient(isolated.uri, { serverSelectionTimeoutMS: 8_000 }).connect();
    const legacyTenantId = `integration-policy-cleanup-${randomUUID()}`;
    const tenantCollection = client.db(dbName).collection<import("../src/lib/repo/types").TenantDoc & { respondentPolicy?: Record<string, unknown> }>("tenants");
    await tenantCollection.insertOne({
      _id: legacyTenantId,
      name: "Legacy respondent policy fixture",
      slug: legacyTenantId,
      status: "active",
      analyticsMinimumCellSize: 9,
      respondentPolicy: { revision: 1, notice: "legacy notice text", retention: "legacy retention text", updatedAt: new Date() },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const signups = client.db(dbName).collection("pending_signups");
    const signupNow = new Date();
    const olderClaimId = new mongo.ObjectId("000000000000000000000011");
    const newerClaimId = new mongo.ObjectId("000000000000000000000012");
    const tieClaimLowerId = new mongo.ObjectId("000000000000000000000021");
    signupTieWinnerId = new mongo.ObjectId("000000000000000000000022");
    const missingDateLowerId = new mongo.ObjectId("000000000000000000000031");
    signupMissingDateWinnerId = new mongo.ObjectId("000000000000000000000032");
    const signupBase = {
      userId: new mongo.ObjectId(),
      tenantId: new mongo.ObjectId().toHexString(),
      tenantName: "Legacy signup fixture",
      tenantSlug: `legacy-${randomUUID()}`,
      passwordHash: "fixture-hash",
      tokenHash: "fixture-token",
      expiresAt: new Date(signupNow.getTime() + 60_000),
    };
    await signups.insertMany([
      { ...signupBase, _id: olderClaimId, email: "Researcher@Example.com", createdAt: new Date(signupNow.getTime() - 2_000), tokenHash: "older-token" },
      { ...signupBase, _id: newerClaimId, email: " researcher@example.com ", createdAt: new Date(signupNow.getTime() - 1_000), tokenHash: "newer-token" },
      { ...signupBase, _id: tieClaimLowerId, email: "tie@example.com", createdAt: signupNow, tokenHash: "tie-lower-token" },
      { ...signupBase, _id: signupTieWinnerId, email: " TIE@example.com ", createdAt: signupNow, tokenHash: "tie-higher-token" },
      { ...signupBase, _id: missingDateLowerId, email: "no-date@example.com", tokenHash: "no-date-lower-token" },
      { ...signupBase, _id: signupMissingDateWinnerId, email: " NO-DATE@example.com ", tokenHash: "no-date-higher-token" },
      { ...signupBase, _id: new mongo.ObjectId(), email: "  ", createdAt: signupNow, tokenHash: "blank-token" },
      { ...signupBase, _id: new mongo.ObjectId(), email: 42, createdAt: signupNow, tokenHash: "non-string-token" },
      { ...signupBase, _id: new mongo.ObjectId(), email: "expired@example.com", createdAt: signupNow, expiresAt: new Date(signupNow.getTime() - 1), tokenHash: "expired-token" },
      { ...signupBase, _id: new mongo.ObjectId(), email: "consumed@example.com", createdAt: signupNow, consumedAt: signupNow, tokenHash: "consumed-token" },
    ]);
    await dbModule.db(); // Also exercises the real index setup, including the unique operation scope index.
    const cleanedTenant = await tenantCollection.findOne({ _id: legacyTenantId });
    expect(cleanedTenant).not.toHaveProperty("respondentPolicy");
    expect(cleanedTenant?.analyticsMinimumCellSize).toBe(9);
    expect(await client.db(dbName).collection<{ _id: string }>("schema_migrations").countDocuments({ _id: "remove_respondent_policy_fields_v1" })).toBe(1);

    interviewId = new mongo.ObjectId();
    await (await dbModule.col.interviews()).insertOne({
      _id: interviewId,
      tenantId: "integration-workspace",
      name: "Retry integration fixture",
      mode: "multi",
      status: "open",
      currentVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, 30_000);

  afterAll(async () => {
    // Close the repository singleton before dropping the isolated DB, and clear
    // globals/env so this test cannot contaminate another suite in this worker.
    const appClientPromise = (globalThis as typeof globalThis & {
      __kqaMongo?: { client: Promise<import("mongodb").MongoClient> };
    }).__kqaMongo?.client;
    if (appClientPromise) {
      const appClient = await appClientPromise.catch(() => null);
      await appClient?.close();
    }
    (globalThis as typeof globalThis & { __kqaMongo?: unknown }).__kqaMongo = undefined;
    if (client && dbName) await client.db(dbName).dropDatabase().catch(() => undefined);
    if (client) await client.close();
    if (previousEnv.mongodbUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousEnv.mongodbUri;
    if (previousEnv.mongodbDb === undefined) delete process.env.MONGODB_DB;
    else process.env.MONGODB_DB = previousEnv.mongodbDb;
    if (previousEnv.axionFallback === undefined) delete process.env.KQA_AXION_LEGACY_TENANT_FALLBACK;
    else process.env.KQA_AXION_LEGACY_TENANT_FALLBACK = previousEnv.axionFallback;
  });

  it("removes stored respondent notice data while preserving analytics settings", async () => {
    const tenants = client.db(dbName).collection("tenants");
    const allTenants = await tenants.find({}).toArray();
    expect(allTenants.every((tenant) => !Object.hasOwn(tenant, "respondentPolicy"))).toBe(true);
    expect(allTenants.some((tenant) => tenant.analyticsMinimumCellSize === 9)).toBe(true);
  });

  it("commits email replacement and one-time verification consumption atomically", async () => {
    const database = client.db(dbName);
    const userId = new mongo.ObjectId();
    const token = `email-change-${randomUUID()}`;
    const oldEmail = `old-${randomUUID()}@example.test`;
    const newEmail = `new-${randomUUID()}@example.test`;
    await database.collection("users").insertOne({
      _id: userId, email: oldEmail, emailVerifiedAt: new Date(), passwordHash: await accounts.hashPassword("fixture password long enough"),
      authVersion: 7, createdAt: new Date(), updatedAt: new Date(),
    });
    const created = await accounts.createPendingEmailChange({ userId: userId.toHexString(), currentPassword: "fixture password long enough", email: newEmail, token });
    expect(created.ok).toBe(true);

    await expect(accounts.completeEmailChange(token)).resolves.toEqual({ ok: true, email: newEmail, previousEmail: oldEmail });
    await expect(accounts.completeEmailChange(token)).resolves.toMatchObject({ ok: false });
    const updated = await database.collection("users").findOne({ _id: userId });
    expect(updated).toMatchObject({ email: newEmail, authVersion: 8 });
    expect(await database.collection("pending_email_changes").countDocuments({ userId })).toBe(0);
  });

  it("rejects a pending email change after credential version changes", async () => {
    const database = client.db(dbName);
    const userId = new mongo.ObjectId();
    const token = `stale-email-change-${randomUUID()}`;
    const oldEmail = `stale-old-${randomUUID()}@example.test`;
    const newEmail = `stale-new-${randomUUID()}@example.test`;
    await database.collection("users").insertOne({
      _id: userId, email: oldEmail, emailVerifiedAt: new Date(), passwordHash: await accounts.hashPassword("fixture password long enough"),
      authVersion: 2, createdAt: new Date(), updatedAt: new Date(),
    });
    const created = await accounts.createPendingEmailChange({ userId: userId.toHexString(), currentPassword: "fixture password long enough", email: newEmail, token });
    expect(created.ok).toBe(true);
    await database.collection("users").updateOne({ _id: userId }, { $inc: { authVersion: 1 } });

    await expect(accounts.completeEmailChange(token)).resolves.toMatchObject({ ok: false });
    const unchanged = await database.collection("users").findOne({ _id: userId });
    expect(unchanged).toMatchObject({ email: oldEmail, authVersion: 3 });
    expect(await database.collection("pending_email_changes").countDocuments({ userId })).toBe(0);
  });

  it("searches and filters interview pages in Mongo before paging, within the current tenant", async () => {
    const database = client.db(dbName);
    const now = new Date();
    const ids = [new mongo.ObjectId(), new mongo.ObjectId(), new mongo.ObjectId(), new mongo.ObjectId()];
    await database.collection("interviews").insertMany([
      { _id: ids[0], tenantId: "search-workspace-a", name: "Civic feedback", description: "Transit service review", mode: "multi", status: "open", currentVersion: 1, createdAt: now, updatedAt: new Date(now.getTime() + 3) },
      { _id: ids[1], tenantId: "search-workspace-a", name: "Regional survey", description: "Transit network review", mode: "multi", status: "open", currentVersion: 1, createdAt: now, updatedAt: new Date(now.getTime() + 2) },
      { _id: ids[2], tenantId: "search-workspace-a", name: "Closed planning", description: "Transit plan", mode: "single", status: "closed", currentVersion: 1, createdAt: now, updatedAt: new Date(now.getTime() + 1) },
      { _id: ids[3], tenantId: "search-workspace-b", name: "Other workspace", description: "Transit service review", mode: "multi", status: "open", currentVersion: 1, createdAt: now, updatedAt: now },
    ]);

    const filters = { search: "transit", status: "open" as const, mode: "multi" as const, limit: 1 };
    const first = await withTenantPrincipal({ tenantId: "search-workspace-a", role: "admin", source: "api_key" }, () => repository.listInterviewPage(filters));
    const second = await withTenantPrincipal({ tenantId: "search-workspace-a", role: "admin", source: "api_key" }, () => repository.listInterviewPage({ ...filters, cursor: first.nextCursor ?? undefined }));

    expect(first.interviews.map((row) => row.id)).toEqual([ids[0].toHexString()]);
    expect(second.interviews.map((row) => row.id)).toEqual([ids[1].toHexString()]);
    expect(first.hasMore).toBe(true);
    expect(second.nextCursor).toBeNull();
  });

  it("replays a submitted response after a lost reply without recording another submit event", async () => {
    const database = client.db(dbName);
    const submitInterviewId = new mongo.ObjectId();
    const now = new Date();
    const html = "<!doctype html><html lang=\"en\"><body><h1>Submit retry fixture</h1></body></html>";
    await database.collection("interviews").insertOne({
      _id: submitInterviewId, tenantId: "integration-workspace", name: "Submit retry fixture",
      mode: "multi", status: "open", currentVersion: 1, createdAt: now, updatedAt: now,
    });
    await database.collection("survey_versions").insertOne({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", interviewId: submitInterviewId, version: 1,
      html, htmlSha256: createHash("sha256").update(html).digest("hex"), bytes: Buffer.byteLength(html),
      manifest: { format: "kqa/1", title: "Submit retry fixture", questions: [{ id: "q1", type: "text", label: "Optional answer", required: false }] },
      check: { errors: 0, warnings: 0, info: 0, checkedAt: now.toISOString(), checkerVersion: "integration" }, createdAt: now,
    });
    const [person] = await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.addParticipants(submitInterviewId.toHexString(), [{ name: "Submit retry fixture" }]),
    );
    const submit = () => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.submitAnswers(person.token, 1, 0),
    );

    const first = await submit();
    const retry = await submit();

    expect(first).toMatchObject({ ok: true, submittedAt: expect.any(String) });
    expect(retry).toEqual(first);
    const saved = await database.collection("participants").findOne({ token: person.token });
    expect(saved).toMatchObject({ status: "submitted", writeEpoch: 1 });
    expect(await database.collection("events").countDocuments({ participantId: saved?._id, type: "submit" })).toBe(1);
  });

  it("keeps a full lookahead respondent out of each streamed export page byte budget", async () => {
    const database = client.db(dbName);
    const participantIds = [new mongo.ObjectId(), new mongo.ObjectId()];
    const createdAt = [new Date("2026-11-20T00:00:00.000Z"), new Date("2026-11-19T00:00:00.000Z")];
    const payload = "x".repeat(5 * 1024 * 1024);
    await database.collection("participants").insertMany(participantIds.map((_id, index) => ({
      _id,
      tenantId: "integration-workspace",
      interviewId,
      token: `large-page-token-${index}`,
      name: `Large page ${index}`,
      status: "invited",
      answers: { note: { value: payload, updatedAt: createdAt[index] } },
      recordGroups: {},
      revision: 0,
      createdAt: createdAt[index],
      updatedAt: createdAt[index],
    })));
    try {
      const first = await withTenantPrincipal({ tenantId: "integration-workspace", role: "admin", source: "api_key" }, () => repository.listParticipantPage(interviewId.toHexString(), null, 1, false, false, 8 * 1024 * 1024));
      const second = await withTenantPrincipal({ tenantId: "integration-workspace", role: "admin", source: "api_key" }, () => repository.listParticipantPage(interviewId.toHexString(), first.nextCursor, 1, false, false, 8 * 1024 * 1024));

      expect(first.people.map((person) => person.id)).toEqual([participantIds[0].toHexString()]);
      expect(first.nextCursor).toBeTruthy();
      expect(second.people.map((person) => person.id)).toEqual([participantIds[1].toHexString()]);
      expect(second.nextCursor).toBeNull();
    } finally {
      await database.collection("participants").deleteMany({ _id: { $in: participantIds } });
    }
  }, 30_000);

  it("normalizes legacy signup claims and keeps the newest deterministic email owner", async () => {
    const signups = client.db(dbName).collection("pending_signups");
    const rows = await signups.find({}).sort({ email: 1 }).toArray();
    expect(rows.map((row) => row.email).sort()).toEqual(["no-date@example.com", "researcher@example.com", "tie@example.com"]);
    expect(rows.find((row) => row.email === "researcher@example.com")?._id.toHexString()).toBe("000000000000000000000012");
    expect(rows.find((row) => row.email === "tie@example.com")?._id).toEqual(signupTieWinnerId);
    expect(rows.find((row) => row.email === "no-date@example.com")?._id).toEqual(signupMissingDateWinnerId);
    const uniqueEmailIndex = (await signups.listIndexes().toArray()).find((index) => index.name === "signup_email_unique");
    expect(uniqueEmailIndex).toMatchObject({ unique: true, key: { email: 1 } });
    await expect(signups.insertOne({
      _id: new mongo.ObjectId(), userId: new mongo.ObjectId(), tenantId: "duplicate-probe", tenantName: "Duplicate", tenantSlug: "duplicate-probe",
      email: "researcher@example.com", passwordHash: "fixture", tokenHash: "duplicate-email-probe", createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ code: 11000 });
  });

  it("serializes concurrent duplicate operationIds into one participant mutation", async () => {
    const operation = {
      operationId: `concurrent-${randomUUID()}`,
      credentialId: "api_key:integration-key",
      argumentDigest: "digest-concurrent-ada",
    };
    const add = () => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.addParticipantsWithOperation(interviewId.toHexString(), [{ name: "Ada", email: "ada@example.com", note: "concurrent probe" }], operation),
    );

    const results = await Promise.all([add(), add()]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(["created", "replayed"]);
    const created = results.find((result) => result.kind === "created");
    const replayed = results.find((result) => result.kind === "replayed");
    expect(created?.kind).toBe("created");
    expect(replayed).toEqual({ kind: "replayed", people: created?.kind === "created" ? created.people : [] });
    if (created?.kind === "created") {
      expect(created.people[0]).toMatchObject({ email: "ada@example.com", note: "concurrent probe" });
      expect(Object.hasOwn(created.people[0], "lastSeenAt")).toBe(false);
      expect(Object.hasOwn(created.people[0], "submittedAt")).toBe(false);
    }
    expect(await client.db(dbName).collection("participants").countDocuments({ tenantId: "integration-workspace", interviewId })).toBe(1);
    expect(await client.db(dbName).collection("mcp_operations").countDocuments({ tool: "add_people", tenantId: "integration-workspace" })).toBe(1);
  });

  it("serializes concurrent keyed invitation resends into one pending SMTP attempt", async () => {
    const participantId = new mongo.ObjectId();
    const token = `invite-operation-${randomUUID()}`;
    await (await dbModule.col.participants()).insertOne({
      _id: participantId, tenantId: "integration-workspace", interviewId, token,
      name: "Invite operation fixture", email: "invite-operation@example.com", status: "invited", answers: {}, revision: 0,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const operation = {
      operationId: `invite-resend-${randomUUID()}`,
      credentialId: "api_key:integration-key",
      argumentDigest: createHash("sha256").update(`resend:${participantId.toHexString()}`).digest("hex"),
    };
    const reserve = () => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => mailRepository.insertMailWithOperation({
        interviewId, participantId, kind: "invite", to: "invite-operation@example.com", token,
        status: "pending", messageId: `<${operation.operationId}@example.com>`, sentAt: new Date(), triggeredBy: "mcp",
      }, operation),
    );

    const results = await Promise.all([reserve(), reserve()]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(["created", "replayed"]);
    const created = results.find((result) => result.kind === "created");
    const replayed = results.find((result) => result.kind === "replayed");
    expect(created?.kind).toBe("created");
    expect(replayed?.kind).toBe("replayed");
    expect(await client.db(dbName).collection("mail_messages").countDocuments({ participantId })).toBe(1);

    const lookup = await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => mailRepository.getInviteSendOperation(operation),
    );
    expect(lookup?.kind).toBe("replayed");
    if (lookup?.kind === "replayed") expect(lookup.attempt).toMatchObject({ status: "pending", participantId: participantId.toHexString() });
  });

  it("enforces one actor draft per workspace and revision fences on Mongo", async () => {
    const collection = client.db(dbName).collection("campaign_drafts") as import("mongodb").Collection<import("../src/lib/repo/types").CampaignDraftDoc>;
    const tenantId = `draft-workspace-${randomUUID()}`;
    const userId = `draft-user-${randomUUID()}`;
    const input = { name: "Draft integration", description: "", mode: "single" as const, html: "<html>draft</html>", fileName: "draft.html" };
    const attempts = await Promise.all([
      campaignDrafts.saveCampaignDraftIn(collection, tenantId, userId, 0, input),
      campaignDrafts.saveCampaignDraftIn(collection, tenantId, userId, 0, { ...input, name: "Concurrent" }),
    ]);
    expect(attempts.filter((result) => result.ok)).toHaveLength(1);
    const saved = attempts.find((result) => result.ok);
    expect(saved?.ok && saved.draft.revision).toBe(1);
    expect(await collection.countDocuments({ tenantId, userId })).toBe(1);
    expect(await collection.countDocuments({ tenantId: `${tenantId}-other`, userId })).toBe(0);

    const next = await campaignDrafts.saveCampaignDraftIn(collection, tenantId, userId, 1, { name: "Draft integration", description: "", mode: "single" });
    expect(next.ok && next.draft.revision).toBe(2);
    expect(next.ok && next.draft.html).toBeUndefined();
    expect(await campaignDrafts.saveCampaignDraftIn(collection, tenantId, userId, 1, input)).toMatchObject({ ok: false, currentRevision: 2 });
    expect(await campaignDrafts.discardCampaignDraftIn(collection, tenantId, userId, 2)).toBe(true);
    expect(await collection.countDocuments({ tenantId, userId })).toBe(0);
  });

  it("returns the exact committed result after the first response is lost", async () => {
    const operation = {
      operationId: `lost-response-${randomUUID()}`,
      credentialId: "api_key:integration-key",
      argumentDigest: "digest-lost-response-grace",
    };
    const add = () => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.addParticipantsWithOperation(interviewId.toHexString(), [{ name: "Grace", note: "retry probe" }], operation),
    );

    // Simulate the transport dropping the successful result after Mongo has
    // committed, so the caller sees only a lost-response failure.
    await expect(add().then(() => {
      throw new Error("simulated lost response after commit");
    })).rejects.toThrow("simulated lost response after commit");
    const operationIdHash = createHash("sha256").update(operation.operationId).digest("hex");
    const committed = await client.db(dbName).collection("mcp_operations").findOne({
      tenantId: "integration-workspace",
      tool: "add_people",
      operationIdHash,
    });
    expect(committed).not.toBeNull();
    // Retry only with the same id and payload, then compare with the durable
    // first result since the original response was intentionally discarded.
    const retry = await add();
    expect(retry).toEqual({ kind: "replayed", people: committed?.result.people });
    expect(await client.db(dbName).collection("participants").countDocuments({ tenantId: "integration-workspace", interviewId, name: "Grace" })).toBe(1);
    expect(await client.db(dbName).collection("mcp_operations").countDocuments({
      tenantId: "integration-workspace",
      tool: "add_people",
      operationIdHash,
    })).toBe(1);
  });

  it("replays concurrent update_person writes and scrubs retained profile data on person and interview deletion", async () => {
    const database = client.db(dbName);
    const id = new mongo.ObjectId();
    const personA = new mongo.ObjectId();
    const personB = new mongo.ObjectId();
    const now = new Date();
    await database.collection("interviews").insertOne({
      _id: id, tenantId: "integration-workspace", name: "Update person replay fixture", mode: "multi", status: "open", currentVersion: 1,
      createdAt: now, updatedAt: now,
    });
    await database.collection("participants").insertMany([personA, personB].map((_id) => ({
      _id, tenantId: "integration-workspace", interviewId: id, token: `private-${_id.toHexString()}`, name: "Before", email: "before@example.com",
      note: "old note", status: "invited", answers: {}, revision: 0, writeEpoch: 0, createdAt: now, updatedAt: now,
    })));
    const operationFor = (participantId: import("mongodb").ObjectId, operationId: string) => ({
      operationId, credentialId: "api_key:integration-key", argumentDigest: createHash("sha256").update(JSON.stringify({ participantId: participantId.toHexString(), name: "After" })).digest("hex"),
    });
    const operationA = `update-person-remove-${randomUUID()}`;
    const update = (participantId: import("mongodb").ObjectId, operationId: string) => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.updateParticipantWithOperation(participantId.toHexString(), { name: "After", email: "after@example.com", note: "updated note" }, operationFor(participantId, operationId)),
    );
    const concurrent = await Promise.all([update(personA, operationA), update(personA, operationA)]);
    expect(concurrent.map((result) => result.kind).sort()).toEqual(["replayed", "updated"]);
    expect(await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.updateParticipantWithOperation(personA.toHexString(), { name: "Different" }, { ...operationFor(personA, operationA), argumentDigest: "different-arguments" }),
    )).toEqual({ kind: "conflict" });
    expect(await database.collection("participants").countDocuments({ _id: personA, name: "After" })).toBe(1);
    const operationB = `update-person-interview-${randomUUID()}`;
    expect((await update(personB, operationB)).kind).toBe("updated");

    const operationHashA = createHash("sha256").update(operationA).digest("hex");
    const operationHashB = createHash("sha256").update(operationB).digest("hex");
    const receiptA = await database.collection("mcp_operations").findOne({ tool: "update_person", operationIdHash: operationHashA });
    expect(receiptA?.result.person).toMatchObject({ email: "after@example.com", note: "updated note", token: `private-${personA.toHexString()}` });
    await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.deleteParticipant(personA.toHexString()),
    );
    const scrubbedPersonReceipt = await database.collection("mcp_operations").findOne({ tool: "update_person", operationIdHash: operationHashA });
    expect(scrubbedPersonReceipt).toMatchObject({ result: { deleted: true }, deletedAt: expect.any(Date) });
    expect(JSON.stringify(scrubbedPersonReceipt)).not.toContain("after@example.com");
    expect(await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.getUpdatePersonOperation(operationFor(personA, operationA)),
    )).toEqual({ kind: "deleted" });

    await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.deleteInterview(id.toHexString()),
    );
    const scrubbedInterviewReceipt = await database.collection("mcp_operations").findOne({ tool: "update_person", operationIdHash: operationHashB });
    expect(scrubbedInterviewReceipt).toMatchObject({ result: { deleted: true }, deletedAt: expect.any(Date) });
    expect(JSON.stringify(scrubbedInterviewReceipt)).not.toContain("after@example.com");
  });

  it("erases respondent-linked records once and replays removal after a lost response", async () => {
    const database = client.db(dbName);
    const participantId = new mongo.ObjectId();
    const now = new Date();
    const operation = {
      operationId: `remove-lost-response-${randomUUID()}`,
      credentialId: "api_key:integration-key",
      argumentDigest: "digest-remove-grace",
    };
    const priorOperationId = `add-before-remove-${randomUUID()}`;
    const priorOperationIdHash = createHash("sha256").update(priorOperationId).digest("hex");
    const credentialIdHash = createHash("sha256").update(operation.credentialId).digest("hex");
    const participant = {
      _id: participantId,
      tenantId: "integration-workspace",
      interviewId,
      token: "respondent-secret-token",
      name: "Grace Erased",
      email: "grace-erased@example.com",
      note: "private host note",
      status: "submitted",
      answers: { favorite: "private response" },
      revision: 1,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
    };
    await database.collection("participants").insertOne(participant);
    await database.collection("question_order_assignments").insertOne({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", interviewId, participantId,
      surveyVersion: 1, algorithmVersion: "v1", groups: { section: ["q1", "q2"] }, assignedAt: now,
    });
    await database.collection("events").insertOne({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", interviewId, participantId,
      type: "submit", at: now, meta: { answer: "private response" },
    });
    await database.collection("mail_messages").insertOne({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", interviewId, participantId,
      kind: "invite", to: participant.email, token: participant.token, status: "sent", sentAt: now, triggeredBy: "mcp",
    });
    await database.collection("analytics_runs").insertOne({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", interviewId, slot: 0,
      surveyVersion: 1, createdAt: now, expiresAt: new Date(now.getTime() + 60_000), result: { total: 1 },
    });
    await database.collection("mcp_operations").insertOne({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", tool: "add_people", credentialIdHash,
      operationIdHash: priorOperationIdHash, argumentDigest: "prior-add-digest", interviewId,
      participantIds: [participantId], result: { people: [{ id: participantId.toHexString(), name: participant.name, email: participant.email, token: participant.token }] },
      createdAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const remove = () => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.deleteParticipantWithOperation(participantId.toHexString(), operation),
    );
    const before = await database.collection("interviews").findOne({ _id: interviewId });

    await expect(remove().then(() => {
      throw new Error("simulated lost response after commit");
    })).rejects.toThrow("simulated lost response after commit");

    const afterDelete = await database.collection("interviews").findOne({ _id: interviewId });
    expect(afterDelete?.respondentWriteRevision).toBe((before?.respondentWriteRevision ?? 0) + 1);
    expect(await database.collection("participants").countDocuments({ _id: participantId })).toBe(0);
    expect(await database.collection("question_order_assignments").countDocuments({ participantId })).toBe(0);
    expect(await database.collection("events").countDocuments({ participantId })).toBe(0);
    expect(await database.collection("mail_messages").countDocuments({ participantId })).toBe(0);
    expect(await database.collection("analytics_runs").countDocuments({ interviewId })).toBe(0);

    const priorOperation = await database.collection("mcp_operations").findOne({ tool: "add_people", operationIdHash: priorOperationIdHash });
    expect(priorOperation).toMatchObject({ result: { deleted: true }, deletedAt: expect.any(Date) });
    expect(priorOperation).not.toHaveProperty("argumentDigest");
    expect(priorOperation).not.toHaveProperty("interviewId");
    expect(priorOperation).not.toHaveProperty("participantIds");
    expect(Object.keys(priorOperation ?? {}).sort()).toEqual([
      "_id", "createdAt", "credentialIdHash", "deletedAt", "expiresAt", "operationIdHash", "result", "tenantId", "tool",
    ]);
    expect(JSON.stringify(priorOperation)).not.toContain(participant.email);
    expect(JSON.stringify(priorOperation)).not.toContain(participant.token);
    expect(JSON.stringify(priorOperation)).not.toContain(participant.name);

    const operationIdHash = createHash("sha256").update(operation.operationId).digest("hex");
    const removeOperation = await database.collection("mcp_operations").findOne({
      tenantId: "integration-workspace", tool: "remove_person", credentialIdHash, operationIdHash,
    });
    expect(removeOperation).toMatchObject({ result: { removed: true } });
    expect(removeOperation).not.toHaveProperty("interviewId");
    expect(removeOperation).not.toHaveProperty("participantIds");
    expect(JSON.stringify(removeOperation)).not.toContain(participantId.toHexString());
    expect(JSON.stringify(removeOperation)).not.toContain(interviewId.toHexString());
    expect(Object.keys(removeOperation ?? {}).sort()).toEqual([
      "_id", "argumentDigest", "createdAt", "credentialIdHash", "expiresAt", "operationIdHash", "result", "tenantId", "tool",
    ]);
    expect(JSON.stringify(removeOperation)).not.toContain(operation.credentialId);
    expect(JSON.stringify(removeOperation)).not.toContain(participant.email);
    expect(JSON.stringify(removeOperation)).not.toContain(participant.token);
    expect(await database.collection("mcp_operations").countDocuments({ tool: "remove_person", operationIdHash })).toBe(1);

    const retries = await Promise.all([remove(), remove()]);
    expect(retries).toEqual([{ kind: "replayed" }, { kind: "replayed" }]);
    expect((await database.collection("interviews").findOne({ _id: interviewId }))?.respondentWriteRevision).toBe((before?.respondentWriteRevision ?? 0) + 1);
    expect(await database.collection("mcp_operations").countDocuments({ tool: "remove_person", operationIdHash })).toBe(1);
    expect(await database.collection("participants").countDocuments({ _id: participantId })).toBe(0);
    expect(await database.collection("question_order_assignments").countDocuments({ participantId })).toBe(0);
    expect(await database.collection("events").countDocuments({ participantId })).toBe(0);
    expect(await database.collection("mail_messages").countDocuments({ participantId })).toBe(0);
    expect(await database.collection("analytics_runs").countDocuments({ interviewId })).toBe(0);
  });

  it("recovers the unique-index E11000 race as an operation-id conflict", async () => {
    const secondInterviewId = new mongo.ObjectId();
    await client.db(dbName).collection("interviews").insertOne({
      _id: secondInterviewId,
      tenantId: "integration-workspace",
      name: "Retry race fixture",
      mode: "multi",
      status: "open",
      currentVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const operationId = `unique-index-race-${randomUUID()}`;
    const credentialId = "api_key:integration-key";
    const originalFactory = dbModule.col.mcpOperations;
    let insertArrivals = 0;
    let releaseInserts!: () => void;
    let gateTimer!: ReturnType<typeof setTimeout>;
    const insertGate = new Promise<void>((resolve, reject) => {
      releaseInserts = () => {
        clearTimeout(gateTimer);
        resolve();
      };
      gateTimer = setTimeout(() => reject(new Error("Both operation transactions did not reach ledger insertOne.")), 10_000);
    });

    dbModule.col.mcpOperations = async () => {
      const collection = await originalFactory();
      return new Proxy(collection, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          if (property === "insertOne" && typeof value === "function") {
            return async (...args: Parameters<typeof collection.insertOne>) => {
              insertArrivals += 1;
              if (insertArrivals === 2) releaseInserts();
              await insertGate;
              return value.apply(target, args);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as Awaited<ReturnType<typeof originalFactory>>;
    };

    const operationFor = (argumentDigest: string) => ({ operationId, credentialId, argumentDigest });
    const run = (id: import("mongodb").ObjectId, name: string, argumentDigest: string) => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.addParticipantsWithOperation(id.toHexString(), [{ name }], operationFor(argumentDigest)),
    );

    let results: Awaited<ReturnType<typeof repository.addParticipantsWithOperation>>[];
    try {
      results = await Promise.all([
        run(interviewId, "Winner A", "digest-race-a"),
        run(secondInterviewId, "Winner B", "digest-race-b"),
      ]);
    } finally {
      clearTimeout(gateTimer);
      releaseInserts();
      dbModule.col.mcpOperations = originalFactory;
    }

    expect(insertArrivals).toBe(2);
    // Both transactions passed their empty-ledger read before either insert.
    // The repository only converts a duplicate-key (E11000) transaction error
    // into a replay/conflict; any other error escapes and fails Promise.all.
    expect(results.map(({ kind }) => kind).sort()).toEqual(["conflict", "created"]);
    const created = results.find((result) => result.kind === "created");
    expect(created?.kind).toBe("created");

    const operationIdHash = createHash("sha256").update(operationId).digest("hex");
    const operationRows = await client.db(dbName).collection("mcp_operations").find({
      tenantId: "integration-workspace",
      tool: "add_people",
      credentialIdHash: createHash("sha256").update(credentialId).digest("hex"),
      operationIdHash,
    }).toArray();
    expect(operationRows).toHaveLength(1);
    const winningInterviewId = operationRows[0].interviewId;
    expect([interviewId, secondInterviewId]).toContainEqual(winningInterviewId);
    expect(await client.db(dbName).collection("participants").countDocuments({
      tenantId: "integration-workspace",
      interviewId: { $in: [interviewId, secondInterviewId] },
      name: { $in: ["Winner A", "Winner B"] },
    })).toBe(1);
    expect(await client.db(dbName).collection("participants").countDocuments({
      tenantId: "integration-workspace",
      interviewId: winningInterviewId,
      name: created?.kind === "created" ? created.people[0].name : "",
    })).toBe(1);
    expect(await client.db(dbName).collection("participants").countDocuments({
      tenantId: "integration-workspace",
      interviewId: { $in: [interviewId, secondInterviewId].filter((id) => !id.equals(winningInterviewId)) },
      name: { $in: ["Winner A", "Winner B"] },
    })).toBe(0);
  });

  it("keeps invite refusal and exact confirmation ahead of interview erasure", async () => {
    const database = client.db(dbName);
    const id = new mongo.ObjectId();
    const attemptId = new mongo.ObjectId();
    const operation = { operationId: `delete-confirm-${randomUUID()}`, credentialId: "api_key:integration-key", argumentDigest: "delete-confirm-digest" };
    await database.collection("interviews").insertOne({
      _id: id, tenantId: "integration-workspace", name: "Confirm erase fixture", mode: "multi", status: "open", currentVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await database.collection("mail_messages").insertOne({
      _id: attemptId, tenantId: "integration-workspace", interviewId: id, status: "pending", delivery: "unknown",
    });
    const remove = (name: string) => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.deleteInterviewWithOperation(id.toHexString(), name, operation),
    );

    expect(await remove("wrong name")).toEqual({ kind: "confirmation_mismatch" });
    expect(await database.collection("interviews").findOne({ _id: id })).not.toBeNull();
    expect(await remove("Confirm erase fixture")).toEqual({ kind: "invite_pending" });
    expect(await database.collection("interviews").findOne({ _id: id })).not.toBeNull();
    expect(await database.collection("mcp_operations").countDocuments({ tool: "delete_interview", interviewId: id })).toBe(0);
    await database.collection("mail_messages").deleteOne({ _id: attemptId });

    const results = await Promise.all([remove("Confirm erase fixture"), remove("Confirm erase fixture")]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(["deleted", "replayed"]);
    expect(await database.collection("interviews").findOne({ _id: id })).toBeNull();
    const operationIdHash = createHash("sha256").update(operation.operationId).digest("hex");
    const receipt = await database.collection("mcp_operations").findOne({
      tenantId: "integration-workspace", tool: "delete_interview", operationIdHash,
    });
    expect(receipt).toMatchObject({ result: { ok: true }, argumentDigest: operation.argumentDigest, deletedAt: expect.any(Date) });
    expect(receipt).not.toHaveProperty("interviewId");
    expect(receipt).not.toHaveProperty("participantIds");
    expect(await remove("Confirm erase fixture")).toEqual({ kind: "replayed" });
    expect(await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.deleteInterviewWithOperation(id.toHexString(), "Confirm erase fixture", { ...operation, argumentDigest: "different-delete-args" }),
    )).toEqual({ kind: "conflict" });
  });

  it("replays a deleted-interview receipt after the first response is lost", async () => {
    const database = client.db(dbName);
    const id = new mongo.ObjectId();
    const operation = { operationId: `delete-lost-response-${randomUUID()}`, credentialId: "api_key:integration-key", argumentDigest: "delete-lost-response-digest" };
    await database.collection("interviews").insertOne({
      _id: id, tenantId: "integration-workspace", name: "Lost response delete fixture", mode: "multi", status: "open", currentVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const remove = () => withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => repository.deleteInterviewWithOperation(id.toHexString(), "Lost response delete fixture", operation),
    );

    await expect(remove().then(() => { throw new Error("simulated lost response after commit"); })).rejects.toThrow("simulated lost response after commit");
    expect(await remove()).toEqual({ kind: "replayed" });
    expect(await database.collection("interviews").findOne({ _id: id })).toBeNull();
    expect(await database.collection("mcp_operations").countDocuments({
      tenantId: "integration-workspace", tool: "delete_interview", operationIdHash: createHash("sha256").update(operation.operationId).digest("hex"),
    })).toBe(1);
  });

  it("deletes a legacy unscoped analytics run with its Axion interview", async () => {
    const database = client.db(dbName);
    const id = new mongo.ObjectId();
    await database.collection("interviews").insertOne({
      _id: id, name: "Legacy Axion fixture", mode: "multi", status: "open", currentVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await database.collection("analytics_runs").insertOne({
      _id: new mongo.ObjectId(), interviewId: id, slot: 0, surveyVersion: 1,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), result: { aggregate: true },
    });

    const previousFallback = process.env.KQA_AXION_LEGACY_TENANT_FALLBACK;
    process.env.KQA_AXION_LEGACY_TENANT_FALLBACK = "true";
    try {
      const deleted = await withTenantPrincipal(
        { tenantId: "axion", role: "admin", source: "api_key" },
        () => repository.deleteInterview(id.toHexString()),
      );
      expect(deleted).toBe(true);
      expect(await database.collection("interviews").findOne({ _id: id })).toBeNull();
      expect(await database.collection("analytics_runs").countDocuments({ interviewId: id })).toBe(0);
    } finally {
      if (previousFallback === undefined) delete process.env.KQA_AXION_LEGACY_TENANT_FALLBACK;
      else process.env.KQA_AXION_LEGACY_TENANT_FALLBACK = previousFallback;
    }
  });

  it("pages unresolved mail attempts through an index-backed participant order", async () => {
    const database = client.db(dbName);
    const participantId = new mongo.ObjectId();
    const now = Date.now();
    await database.collection("mail_messages").insertMany(Array.from({ length: 180 }, (_, index) => ({
      _id: new mongo.ObjectId(), tenantId: "integration-workspace", participantId,
      status: index < 120 ? "pending" : "sent",
      delivery: index < 120 ? "unknown" : "delivered",
      sentAt: new Date(now + index),
    })));

    const first = await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => mailRepository.listPendingMailByPerson(participantId, undefined, 50),
    );
    expect(first).toMatchObject({ total: 120, nextCursor: expect.any(String) });
    expect(first.rows).toHaveLength(50);
    const second = await withTenantPrincipal(
      { tenantId: "integration-workspace", role: "admin", source: "api_key" },
      () => mailRepository.listPendingMailByPerson(participantId, new mongo.ObjectId(first.nextCursor!), 50),
    );
    expect(second.rows).toHaveLength(50);
    expect(second.rows.some((row) => first.rows.some((prior) => row._id.equals(prior._id)))).toBe(false);

    const plan = await database.collection("mail_messages").find({
      tenantId: "integration-workspace", participantId, status: "pending", delivery: { $nin: ["delivered", "bounced"] },
    }).sort({ _id: -1 }).limit(50).explain("executionStats");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toMatch(/"stage"\s*:\s*"SORT"/);
  });

  it("re-scans an already-checkpointed collection after a late legacy write", async () => {
    const migrationDbName = `tenant_mig_${randomUUID().replaceAll("-", "")}`;
    const database = client.db(migrationDbName);
    const interviewId = new mongo.ObjectId();
    await database.collection("interviews").insertOne({
      _id: interviewId, name: "Late legacy migration fixture", mode: "multi", status: "open", currentVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await database.collection("survey_versions").insertOne({
      _id: new mongo.ObjectId(), interviewId, version: 1, html: "<!doctype html>", manifest: { format: "kqa/1" }, createdAt: new Date(),
    });

    const interruptedDb = {
      collection(name: string) {
        const collection = database.collection(name);
        if (name !== "survey_versions") return collection;
        return new Proxy(collection, {
          get(target, property, receiver) {
            if (property === "updateMany") return async () => { throw new Error("simulated interruption after interview checkpoint"); };
            return Reflect.get(target, property, receiver);
          },
        });
      },
    } as unknown as import("mongodb").Db;

    try {
      await expect(tenantMigration.backfillLegacyTenant(interruptedDb)).rejects.toThrow("simulated interruption");
      expect((await database.collection<import("../src/lib/repo/types").TenantDoc>("tenants").findOne({ _id: "axion" }))?.legacyTenantMigration?.completedCollections).toContain("interviews");
      await database.collection("interviews").updateOne({ _id: interviewId }, { $unset: { tenantId: "" } });

      await tenantMigration.backfillLegacyTenant(database);
      expect((await database.collection("interviews").findOne({ _id: interviewId }))?.tenantId).toBe("axion");
      expect((await database.collection<import("../src/lib/repo/types").TenantDoc>("tenants").findOne({ _id: "axion" }))?.legacyTenantMigration?.state).toBe("complete");
    } finally {
      await database.dropDatabase();
    }
  });

  it("keeps a confirmed workspace delivery when an unknown check is saved to Mongo", async () => {
    const database = client.db(dbName);
    const id = new mongo.ObjectId();
    await database.collection("workspace_invitations").insertOne({
      _id: id, tenantId: "integration-workspace", email: "invitee@example.test", messageId: "<confirmed-workspace@example.test>",
      mailStatus: "sent", delivery: "delivered", deliveryDetail: "250 accepted", deliveryCheckedAt: new Date(),
    });

    const effective = await workspaceRepository.updateWorkspaceInvitationMail("integration-workspace", id.toHexString(), "<confirmed-workspace@example.test>", {
      delivery: "unknown", deliveryDetail: "not visible on this check", deliveryCheckedAt: new Date(),
    });

    expect(effective).toBe("delivered");
    expect(await database.collection("workspace_invitations").findOne({ _id: id })).toMatchObject({ delivery: "delivered", deliveryDetail: "250 accepted" });
  });
});
