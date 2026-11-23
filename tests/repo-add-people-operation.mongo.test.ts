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
  let repository!: typeof import("../src/lib/repo");
  let mailRepository!: typeof import("../src/lib/repo/mail");
  let withTenantPrincipal!: typeof import("../src/lib/tenant-context").withTenantPrincipal;
  let interviewId!: import("mongodb").ObjectId;
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
    repository = await import("../src/lib/repo");
    mailRepository = await import("../src/lib/repo/mail");
    ({ withTenantPrincipal } = await import("../src/lib/tenant-context"));
    client = await new mongo.MongoClient(isolated.uri, { serverSelectionTimeoutMS: 8_000 }).connect();
    await dbModule.db(); // Also exercises the real index setup, including the unique operation scope index.

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
    expect(removeOperation).toMatchObject({
      result: { ok: true }, interviewId, participantIds: [participantId], argumentDigest: operation.argumentDigest,
    });
    expect(Object.keys(removeOperation ?? {}).sort()).toEqual([
      "_id", "argumentDigest", "createdAt", "credentialIdHash", "expiresAt", "interviewId", "operationIdHash", "participantIds", "result", "tenantId", "tool",
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
});
