import { createHash, randomBytes } from "node:crypto";
import { Binary, ObjectId } from "mongodb";
import { col, withMongoTransaction } from "../db";
import { currentTenantId, tenantFilter } from "../tenant-context";
import { MAX_IMAGE_BYTES, type ImageAssetSummary } from "../image-assets";
import type { ImageAssetDoc } from "./types";

export { MAX_IMAGE_BYTES } from "../image-assets";
export type { ImageAssetSummary } from "../image-assets";

function normalizedFileName(value: string): string {
  const leaf = value.replace(/\\/g, "/").split("/").pop() ?? "image";
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || "image";
}

function mediaType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) return "image/gif";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp" && /^(?:avif|avis)$/.test(data.toString("ascii", 8, 12))) return "image/avif";
  if (data.length >= 2 && data.toString("ascii", 0, 2) === "BM") return "image/bmp";
  if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0) return "image/x-icon";

  const text = data.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (text.length <= MAX_IMAGE_BYTES && !/<!DOCTYPE|<!ENTITY/i.test(text) && /<svg(?:\s|>)/i.test(text.slice(0, 8192))) return "image/svg+xml";
  return null;
}

function summary(doc: ImageAssetDoc): ImageAssetSummary {
  return {
    id: doc._id.toHexString(), name: doc.name, fileName: doc.fileName, mimeType: doc.mimeType,
    bytes: doc.bytes, sha256: doc.sha256, url: `/api/assets/${doc.publicId}`,
    createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(),
  };
}

function toOid(value: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(value) ? new ObjectId(value) : null;
}

export function inspectImage(data: Buffer): { ok: true; mimeType: string } | { ok: false; error: string } {
  if (data.length === 0) return { ok: false, error: "Choose an image file." };
  if (data.length > MAX_IMAGE_BYTES) return { ok: false, error: `Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.` };
  const detected = mediaType(data);
  return detected ? { ok: true, mimeType: detected } : { ok: false, error: "Use a valid PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, or SVG image." };
}

export async function addImageAsset(input: { name?: string; fileName: string; data: Buffer }): Promise<ImageAssetSummary> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const detected = inspectImage(input.data);
  if (!detected.ok) throw new Error(detected.error);
  const now = new Date();
  const fileName = normalizedFileName(input.fileName);
  const name = (input.name?.trim() || fileName).slice(0, 120);
  const doc: ImageAssetDoc = {
    _id: new ObjectId(), tenantId, publicId: randomBytes(32).toString("base64url"),
    name, fileName, mimeType: detected.mimeType, bytes: input.data.length,
    sha256: createHash("sha256").update(input.data).digest("hex"), data: Buffer.from(input.data),
    createdAt: now, updatedAt: now,
  };
  await (await col.imageAssets()).insertOne(doc);
  return summary(doc);
}

export async function listImageAssets(input: { cursor?: string; limit?: number } = {}): Promise<{ assets: ImageAssetSummary[]; nextCursor: string | null }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { assets: [], nextCursor: null };
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 30)));
  const cursor = input.cursor ? toOid(input.cursor) : null;
  if (input.cursor && !cursor) return { assets: [], nextCursor: null };
  const filter = tenantFilter(tenantId, cursor ? { _id: { $lt: cursor } } : {});
  const docs = await (await col.imageAssets()).find(filter, { projection: { data: 0 } }).sort({ _id: -1 }).limit(limit + 1).toArray();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  return { assets: page.map(summary), nextCursor: hasMore && page.length ? page[page.length - 1]._id.toHexString() : null };
}

export async function getPublicImageAsset(publicId: string): Promise<{ mimeType: string; data: Buffer; fileName: string; sha256: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(publicId)) return null;
  const asset = await (await col.imageAssets()).findOne({ publicId }, { projection: { mimeType: 1, data: 1, fileName: 1, sha256: 1 } });
  if (!asset) return null;
  const data = Buffer.isBuffer(asset.data) ? Buffer.from(asset.data) : Buffer.from(asset.data instanceof Binary ? asset.data.value() : asset.data);
  return { mimeType: asset.mimeType, data, fileName: asset.fileName, sha256: asset.sha256 };
}

export async function renameImageAsset(id: string, name: string): Promise<ImageAssetSummary | null> {
  const oid = toOid(id);
  const tenantId = await currentTenantId();
  const trimmed = name.trim().slice(0, 120);
  if (!oid || !tenantId || !trimmed) return null;
  const doc = await (await col.imageAssets()).findOneAndUpdate(
    tenantFilter(tenantId, { _id: oid }),
    { $set: { name: trimmed, updatedAt: new Date() } },
    { returnDocument: "after", projection: { data: 0 } },
  );
  return doc ? summary(doc) : null;
}

export async function deleteImageAsset(id: string, expectedName: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "in_use" | "confirmation_mismatch" }> {
  const oid = toOid(id);
  const tenantId = await currentTenantId();
  if (!oid || !tenantId) return { ok: false, reason: "not_found" };
  const result = await withMongoTransaction(async (session) => {
    const assets = await col.imageAssets();
    const asset = await assets.findOne(tenantFilter(tenantId, { _id: oid }), { session, projection: { name: 1, publicId: 1 } });
    if (!asset) return "not_found" as const;
    if (asset.name !== expectedName) return "confirmation_mismatch" as const;

    // Publication conditionally updates this same asset row in its transaction.
    // The delete write therefore conflicts with a concurrent publish, forcing
    // one transaction to retry against the other's committed state.
    const pattern = asset.publicId;
    const version = await (await col.versions()).findOne(
      tenantFilter(tenantId, { html: { $regex: pattern } }),
      { session, projection: { _id: 1 } },
    );
    const draft = await (await col.questionnaireReviewDrafts()).findOne(
      tenantFilter(tenantId, { html: { $regex: pattern }, expiresAt: { $gt: new Date() } }),
      { session, projection: { _id: 1 } },
    );
    if (version || draft) return "in_use" as const;

    // Keep the exact confirmation and public ID in the conditional delete.
    const deleted = await assets.deleteOne(tenantFilter(tenantId, { _id: oid, name: expectedName, publicId: asset.publicId }), { session });
    return deleted.deletedCount ? "deleted" as const : "changed" as const;
  });
  if (result === "deleted") return { ok: true };
  if (result === "in_use") return { ok: false, reason: "in_use" };
  if (result === "not_found") return { ok: false, reason: "not_found" };
  if (result === "confirmation_mismatch") return { ok: false, reason: "confirmation_mismatch" };
  const current = await (await col.imageAssets()).findOne(tenantFilter(tenantId, { _id: oid }), { projection: { _id: 1 } });
  return current ? { ok: false, reason: "confirmation_mismatch" } : { ok: false, reason: "not_found" };
}
