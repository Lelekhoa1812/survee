import { Binary, ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  tenantId: "tenant-a",
  assets: [] as any[],
  versions: [] as any[],
  drafts: [] as any[],
  renameBeforeDelete: false,
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (session: unknown) => Promise<unknown>) => work({ transaction: true }),
  col: {
    imageAssets: async () => ({
      insertOne: async (doc: any) => { store.assets.push(doc); return { insertedId: doc._id }; },
      findOne: async (filter: any, options?: any) => {
        const doc = store.assets.find((item) => matches(item, filter));
        if (!doc) return null;
        return options?.projection?.data ? { ...doc, data: new Binary(doc.data) } : doc;
      },
      find: (filter: any) => {
        const rows = store.assets.filter((doc) => matches(doc, filter));
        const cursor: any = {
          values: rows,
          sort() { this.values.sort((a: any, b: any) => b._id.toHexString().localeCompare(a._id.toHexString())); return this; },
          limit(value: number) { this.values = this.values.slice(0, value); return this; },
          toArray: async () => cursor.values,
        };
        return cursor;
      },
      findOneAndUpdate: async (filter: any, update: any) => {
        const doc = store.assets.find((item) => matches(item, filter));
        if (!doc) return null;
        Object.assign(doc, update.$set);
        return doc;
      },
      deleteOne: async (filter: any) => {
        if (store.renameBeforeDelete) {
          store.renameBeforeDelete = false;
          const doc = store.assets.find((item) => item._id.equals(filter._id));
          if (doc) doc.name = "Renamed during delete";
        }
        const index = store.assets.findIndex((doc) => matches(doc, filter));
        if (index < 0) return { deletedCount: 0 };
        store.assets.splice(index, 1);
        return { deletedCount: 1 };
      },
    }),
    versions: async () => ({ findOne: async (filter: any) => store.versions.find((doc) => matches(doc, filter)) ?? null }),
    questionnaireReviewDrafts: async () => ({ findOne: async (filter: any) => store.drafts.find((doc) => matches(doc, filter)) ?? null }),
  },
}));

vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => store.tenantId,
  tenantFilter: (tenantId: string, filter: Record<string, unknown> = {}) => ({ tenantId, ...filter }),
}));

function matches(doc: any, filter: any): boolean {
  if (filter.tenantId !== undefined && doc.tenantId !== filter.tenantId) return false;
  if (filter.publicId !== undefined && doc.publicId !== filter.publicId) return false;
  if (filter.name !== undefined && doc.name !== filter.name) return false;
  if (filter._id instanceof ObjectId && !doc._id.equals(filter._id)) return false;
  if (filter._id?.$lt instanceof ObjectId && !(doc._id.toHexString() < filter._id.$lt.toHexString())) return false;
  if (filter.html?.$regex && !new RegExp(filter.html.$regex).test(doc.html)) return false;
  if (filter.expiresAt?.$gt && !(doc.expiresAt > filter.expiresAt.$gt)) return false;
  return true;
}

import { addImageAsset, deleteImageAsset, getPublicImageAsset, inspectImage, listImageAssets, MAX_IMAGE_BYTES, renameImageAsset } from "../src/lib/repo/assets";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

beforeEach(() => {
  store.tenantId = "tenant-a";
  store.assets.splice(0);
  store.versions.splice(0);
  store.drafts.splice(0);
  store.renameBeforeDelete = false;
});

describe("workspace image assets", () => {
  it("detects browser image formats from bytes and rejects spoofed or oversized files", () => {
    const cases: [Buffer, string][] = [
      [png, "image/png"],
      [Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"],
      [Buffer.from("GIF89a"), "image/gif"],
      [Buffer.from("RIFFxxxxWEBP"), "image/webp"],
      [Buffer.from("xxxxftypavif"), "image/avif"],
      [Buffer.from("BM"), "image/bmp"],
      [Buffer.from([0, 0, 1, 0]), "image/x-icon"],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'), "image/svg+xml"],
    ];
    for (const [data, mimeType] of cases) expect(inspectImage(data)).toEqual({ ok: true, mimeType });
    expect(inspectImage(Buffer.from("not an image")).ok).toBe(false);
    const oversized = inspectImage(Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error).toMatch(/2 MB or smaller/);
    expect(inspectImage(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).ok).toBe(false);
  });

  it("stores binary bytes under the active tenant and returns a reusable opaque URL", async () => {
    const asset = await addImageAsset({ name: "Brand mark", fileName: "folder\\logo.png", data: png });
    expect(asset).toMatchObject({ name: "Brand mark", fileName: "logo.png", mimeType: "image/png", bytes: png.length });
    expect(asset.url).toMatch(/^\/api\/assets\/[A-Za-z0-9_-]{43}$/);
    expect(store.assets[0]).toMatchObject({ tenantId: "tenant-a", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(store.assets[0].data.equals(png)).toBe(true);
    await expect(getPublicImageAsset(asset.url.split("/").pop()!)).resolves.toMatchObject({ mimeType: "image/png", data: png });
    expect(await getPublicImageAsset("short-id")).toBeNull();
  });

  it("paginates without imposing a total asset count cap and scopes lists to the workspace", async () => {
    await Promise.all(["one", "two", "three"].map((name) => addImageAsset({ name, fileName: `${name}.png`, data: png })));
    const first = await listImageAssets({ limit: 2 });
    expect(first.assets).toHaveLength(2);
    expect(first.nextCursor).toMatch(/^[a-f0-9]{24}$/);
    const second = await listImageAssets({ cursor: first.nextCursor!, limit: 2 });
    expect(second.assets).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    store.tenantId = "tenant-b";
    expect(await listImageAssets()).toEqual({ assets: [], nextCursor: null });
  });

  it("renames images, blocks deleting referenced assets, and requires the exact name to delete", async () => {
    const asset = await addImageAsset({ name: "Logo", fileName: "logo.png", data: png });
    expect(await renameImageAsset(asset.id, "New logo")).toMatchObject({ name: "New logo" });
    expect(await deleteImageAsset(asset.id, "Logo")).toEqual({ ok: false, reason: "confirmation_mismatch" });

    store.versions.push({ tenantId: "tenant-a", html: `<img src="${asset.url}">` });
    expect(await deleteImageAsset(asset.id, "New logo")).toEqual({ ok: false, reason: "in_use" });
    store.versions.splice(0);
    store.drafts.push({ tenantId: "tenant-a", html: asset.url, expiresAt: new Date(Date.now() + 60_000) });
    expect(await deleteImageAsset(asset.id, "New logo")).toEqual({ ok: false, reason: "in_use" });
    store.drafts.splice(0);
    expect(await deleteImageAsset(asset.id, "New logo")).toEqual({ ok: true });
    expect(store.assets).toHaveLength(0);
  });

  it("does not allow a different tenant to rename or delete an image", async () => {
    const asset = await addImageAsset({ name: "Logo", fileName: "logo.png", data: png });
    store.tenantId = "tenant-b";
    expect(await renameImageAsset(asset.id, "Changed")).toBeNull();
    expect(await deleteImageAsset(asset.id, "Logo")).toEqual({ ok: false, reason: "not_found" });
    expect(store.assets).toHaveLength(1);
  });

  it("does not delete an asset if it is renamed after confirmation but before deletion", async () => {
    const asset = await addImageAsset({ name: "Logo", fileName: "logo.png", data: png });
    store.renameBeforeDelete = true;

    expect(await deleteImageAsset(asset.id, "Logo")).toEqual({ ok: false, reason: "confirmation_mismatch" });
    expect(store.assets).toHaveLength(1);
    expect(store.assets[0].name).toBe("Renamed during delete");
  });
});
