import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: true,
  pending: false,
  resolutionPurpose: null as string | null,
  calls: [] as { collection: string; filter: unknown; update?: unknown; options: unknown }[],
  operations: [] as Array<Record<string, any>>,
  session: { transaction: true },
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work(mocks.session)),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({
      findOne: async (filter: unknown, options: unknown) => {
        mocks.calls.push({ collection: "participants.findOne", filter, options });
        return mocks.current ? { _id: participantId, interviewId: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb") } : null;
      },
      updateOne: async (filter: unknown, update: unknown, options: unknown) => {
        mocks.calls.push({ collection: "participants.updateOne", filter, update, options });
        return { matchedCount: mocks.current ? 1 : 0 };
      },
    }),
    mail: async () => ({
      findOne: async (filter: unknown, options: unknown) => {
        mocks.calls.push({ collection: "mail.findOne", filter, options });
        const clauses = ((filter as Record<string, unknown>).$and as Record<string, unknown>[] | undefined);
        const guard = clauses?.find((clause) => "resolution" in clause) ?? filter as Record<string, unknown>;
        const allowsResolved = (guard.resolution as { $exists?: boolean } | undefined)?.$exists === false;
        return mocks.pending && !(allowsResolved && Boolean(mocks.resolutionPurpose)) ? { _id: new ObjectId() } : null;
      },
    }),
    mcpOperations: async () => ({
      findOne: async (filter: Record<string, unknown>) => mocks.operations.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null,
      deleteOne: async ({ _id }: { _id: unknown }) => { const index = mocks.operations.findIndex((row) => row._id === _id); if (index >= 0) mocks.operations.splice(index, 1); return { deletedCount: index >= 0 ? 1 : 0 }; },
      insertOne: async (row: Record<string, any>) => { mocks.operations.push(row); return { insertedId: row._id }; },
    }),
  },
}));

import { regenerateToken, regenerateTokenWithOperation, getRegenerateLinkOperation } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const participantId = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");
const asTenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, work);

beforeEach(() => {
  mocks.current = true;
  mocks.pending = false;
  mocks.resolutionPurpose = null;
  mocks.calls.length = 0;
  mocks.operations.length = 0;
  mocks.withMongoTransaction.mockClear();
});

describe("regenerateToken", () => {
  it("replays the same rotated link for an operation retry and conflicts on changed arguments", async () => {
    const operation = { operationId: "rotate-1", credentialId: "api_key:key-a", argumentDigest: "digest-a" };
    const first = await asTenant(() => regenerateTokenWithOperation(participantId.toHexString(), operation));
    const replay = await asTenant(() => regenerateTokenWithOperation(participantId.toHexString(), operation));
    expect(first.kind).toBe("rotated");
    expect(replay).toEqual({ ...(first.kind === "rotated" ? { token: first.token, interviewId: first.interviewId } : {}), kind: "replayed" });
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.calls.filter((call) => call.collection === "participants.updateOne")).toHaveLength(1);
    const mismatch = await asTenant(() => regenerateTokenWithOperation(participantId.toHexString(), { ...operation, argumentDigest: "digest-b" }));
    expect(mismatch).toEqual({ kind: "conflict" });
    expect(await asTenant(() => getRegenerateLinkOperation(operation))).toMatchObject({ kind: "replayed", interviewId: "bbbbbbbbbbbbbbbbbbbbbbbb" });
  });

  it("refuses to rotate a link while an invite attempt is unresolved", async () => {
    mocks.pending = true;

    const result = await asTenant(() => regenerateToken(participantId.toHexString()));

    expect(result).toBe("invite_pending");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map((call) => call.collection)).toEqual(["participants.findOne", "mail.findOne"]);
    expect(mocks.calls[1].filter).toEqual(tenantFilter("workspace-1", { participantId, status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false } }));
    expect(mocks.calls.every((call) => (call.options as { session?: unknown }).session === mocks.session)).toBe(true);
  });

  it("rotates when no unresolved attempt remains and serializes with invitation reservation", async () => {
    const result = await asTenant(() => regenerateToken(participantId.toHexString()));

    expect(result).toMatch(/^[A-Za-z0-9_-]{22,32}$/);
    expect(mocks.calls.map((call) => call.collection)).toEqual(["participants.findOne", "mail.findOne", "participants.updateOne"]);
    expect(mocks.calls[0].filter).toEqual(tenantFilter("workspace-1", { _id: participantId }));
    expect(mocks.calls[2]).toMatchObject({
      collection: "participants.updateOne",
      filter: tenantFilter("workspace-1", { _id: participantId }),
      update: { $set: { token: result, updatedAt: expect.any(Date) }, $inc: { inviteAttemptRevision: 1 } },
      options: { session: mocks.session },
    });
  });

  it("allows link rotation only after a token-rotation disposition", async () => {
    mocks.pending = true;
    mocks.resolutionPurpose = "token_rotation";
    const result = await asTenant(() => regenerateToken(participantId.toHexString()));
    expect(result).toMatch(/^[A-Za-z0-9_-]{22,32}$/);
    expect(mocks.calls[1].filter).toEqual(tenantFilter("workspace-1", { participantId, status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false } }));
  });

  it("allows a later link rotation after an email-change acknowledgement", async () => {
    mocks.pending = true;
    mocks.resolutionPurpose = "email_change";
    const result = await asTenant(() => regenerateToken(participantId.toHexString()));
    expect(result).toMatch(/^[A-Za-z0-9_-]{22,32}$/);
  });

  it("returns null when the tenant-scoped participant no longer exists", async () => {
    mocks.current = false;

    const result = await asTenant(() => regenerateToken(participantId.toHexString()));

    expect(result).toBeNull();
    expect(mocks.calls.map((call) => call.collection)).toEqual(["participants.findOne"]);
  });
});
