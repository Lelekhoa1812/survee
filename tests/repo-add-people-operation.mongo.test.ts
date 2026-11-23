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

integration("addParticipantsWithOperation MongoDB replica-set integration", () => {
  let dbName: string;
  let client!: import("mongodb").MongoClient;
  let mongo!: typeof import("mongodb");
  let dbModule!: typeof import("../src/lib/db");
  let repository!: typeof import("../src/lib/repo");
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
});
