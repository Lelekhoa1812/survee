import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenantId: "tenant-a",
  asset: null as any,
  versions: [] as any[],
  currentVersion: 4,
  baseHash: "c".repeat(64),
  pauseFirstReferenceScan: false,
  scanReached: null as null | (() => void),
  releaseScan: null as null | (() => void),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (session: any) => Promise<unknown>) => {
    for (let attempt = 0; ; attempt += 1) {
      const session = { assetRevisionAtStart: state.asset?.referenceRevision ?? null };
      try {
        return await work(session);
      } catch (error) {
        if ((error as any)?.code !== 112 || attempt >= 3) throw error;
      }
    }
  },
  col: {
    imageAssets: async () => ({
      findOne: async (filter: any) => state.asset && matches(state.asset, filter) ? state.asset : null,
      updateOne: async (filter: any, update: any) => {
        if (!state.asset || !matches(state.asset, filter)) return { matchedCount: 0 };
        state.asset.referenceRevision = (state.asset.referenceRevision ?? 0) + (update.$inc?.referenceRevision ?? 0);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      deleteOne: async (filter: any, options: any) => {
        if (options?.session && options.session.assetRevisionAtStart !== (state.asset?.referenceRevision ?? null)) {
          throw Object.assign(new Error("write conflict"), { code: 112 });
        }
        if (!state.asset || !matches(state.asset, filter)) return { deletedCount: 0 };
        state.asset = null;
        return { deletedCount: 1 };
      },
    }),
    versions: async () => ({
      findOne: async (filter: any) => {
        if (filter.html?.$regex) {
          const found = state.versions.find((version) => matches(version, filter)) ?? null;
          if (state.pauseFirstReferenceScan) {
            state.pauseFirstReferenceScan = false;
            state.scanReached?.();
            await new Promise<void>((resolve) => { state.releaseScan = resolve; });
          }
          return found;
        }
        return filter.version === state.currentVersion
          ? { htmlSha256: state.baseHash }
          : null;
      },
      insertOne: async (version: any) => { state.versions.push(version); },
    }),
    questionnaireReviewDrafts: async () => ({ findOne: async () => null }),
    interviews: async () => ({
      findOne: async (filter: any) => filter.currentVersion === state.currentVersion ? { currentVersion: state.currentVersion } : null,
      updateOne: async (filter: any, update: any) => {
        if (filter.currentVersion !== state.currentVersion) return { modifiedCount: 0 };
        state.currentVersion = update.$set.currentVersion;
        return { modifiedCount: 1 };
      },
    }),
    events: async () => ({ insertOne: async () => ({}) }),
  },
}));

vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => state.tenantId,
  tenantFilter: (tenantId: string, filter: Record<string, unknown> = {}) => ({ tenantId, ...filter }),
  withTenantPrincipal: async (principal: { tenantId: string }, work: () => Promise<unknown>) => {
    const previousTenantId = state.tenantId;
    state.tenantId = principal.tenantId;
    try { return await work(); } finally { state.tenantId = previousTenantId; }
  },
}));

function matches(doc: any, filter: any): boolean {
  if (filter.tenantId !== undefined && doc.tenantId !== filter.tenantId) return false;
  if (filter.publicId !== undefined && doc.publicId !== filter.publicId) return false;
  if (filter.name !== undefined && doc.name !== filter.name) return false;
  if (filter._id instanceof ObjectId && !doc._id.equals(filter._id)) return false;
  if (filter.html?.$regex && !new RegExp(filter.html.$regex).test(doc.html)) return false;
  return true;
}

import { deleteImageAsset } from "../src/lib/repo/assets";
import { publishVersionIfCurrent } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = new ObjectId().toHexString();
const publicId = "z".repeat(43);
const survey = {
  html: `<img src="/api/assets/${publicId}">`,
  manifest: { format: "kqa/1" as const, title: "New", questions: [] },
  check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" },
};

beforeEach(() => {
  state.tenantId = "tenant-a";
  state.asset = { _id: new ObjectId(), tenantId: "tenant-a", publicId, name: "Logo", referenceRevision: 0 };
  state.versions.splice(0);
  state.currentVersion = 4;
  state.pauseFirstReferenceScan = false;
  state.scanReached = null;
  state.releaseScan = null;
});

describe("asset deletion and publication coordination", () => {
  it("retries deletion after a publish touches the asset during its reference scan", async () => {
    let markScanReached!: () => void;
    const scanReached = new Promise<void>((resolve) => { markScanReached = resolve; });
    state.pauseFirstReferenceScan = true;
    state.scanReached = markScanReached;

    const deletion = withTenantPrincipal({ tenantId: "tenant-a", role: "admin", source: "session" }, () => deleteImageAsset(state.asset._id.toHexString(), "Logo"));
    await scanReached;

    const published = await withTenantPrincipal({ tenantId: "tenant-a", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, state.baseHash, survey));
    expect(published).toEqual({ version: 5 });
    state.releaseScan?.();

    await expect(deletion).resolves.toEqual({ ok: false, reason: "in_use" });
    expect(state.asset).not.toBeNull();
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0].html).toContain(`/api/assets/${publicId}`);
  });

  it("does not publish after deletion wins the shared asset write", async () => {
    const removed = await withTenantPrincipal({ tenantId: "tenant-a", role: "admin", source: "session" }, () => deleteImageAsset(state.asset._id.toHexString(), "Logo"));
    expect(removed).toEqual({ ok: true });

    const published = await withTenantPrincipal({ tenantId: "tenant-a", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, state.baseHash, survey));
    expect(published).toEqual({ assetUnavailable: true });
    expect(state.versions).toHaveLength(0);
  });
});
