import { ObjectId, type Collection } from "mongodb";
import { db } from "./db";
import { LIMITS } from "./format/schema";
import type { CampaignDraftDoc, InterviewMode } from "./repo/types";

export interface CampaignDraftInput {
  name: string;
  description: string;
  mode: InterviewMode;
  html?: string;
  fileName?: string;
}

export function validateCampaignDraft(value: unknown): CampaignDraftInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || row.name.length > 120 || typeof row.description !== "string" || row.description.length > 500) return null;
  if (row.mode !== "single" && row.mode !== "multi") return null;
  if (row.html !== undefined && (typeof row.html !== "string" || Buffer.byteLength(row.html, "utf8") > LIMITS.maxFileBytes)) return null;
  if (row.fileName !== undefined && (typeof row.fileName !== "string" || row.fileName.length > 200)) return null;
  return {
    name: row.name,
    description: row.description,
    mode: row.mode,
    ...(typeof row.html === "string" ? { html: row.html } : {}),
    ...(typeof row.fileName === "string" ? { fileName: row.fileName } : {}),
  };
}

export function campaignDraftCollection(): Promise<Collection<CampaignDraftDoc>> {
  return db().then((database) => database.collection<CampaignDraftDoc>("campaign_drafts"));
}

export async function getCampaignDraft(tenantId: string, userId: string): Promise<CampaignDraftDoc | null> {
  return (await campaignDraftCollection()).findOne({ tenantId, userId });
}

export type SaveCampaignDraftResult = { ok: true; draft: CampaignDraftDoc } | { ok: false; currentRevision: number | null };

/** Revision 0 creates a slot; later writes compare and advance its revision atomically. */
export async function saveCampaignDraft(tenantId: string, userId: string, revision: number, input: CampaignDraftInput): Promise<SaveCampaignDraftResult> {
  const collection = await campaignDraftCollection();
  return saveCampaignDraftIn(collection, tenantId, userId, revision, input);
}

export async function saveCampaignDraftIn(collection: Collection<CampaignDraftDoc>, tenantId: string, userId: string, revision: number, input: CampaignDraftInput): Promise<SaveCampaignDraftResult> {
  const now = new Date();
  if (revision === 0) {
    try {
      const draft: CampaignDraftDoc = { _id: new ObjectId(), tenantId, userId, revision: 1, ...input, updatedAt: now };
      await collection.insertOne(draft);
      return { ok: true, draft };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      const current = await collection.findOne({ tenantId, userId }, { projection: { revision: 1 } });
      return { ok: false, currentRevision: current?.revision ?? null };
    }
  }
  const result = await collection.updateOne(
    { tenantId, userId, revision },
    {
      $set: { ...input, updatedAt: now },
      ...(!input.html ? { $unset: { html: "", fileName: "" } } : {}),
      $inc: { revision: 1 },
    },
  );
  if (result.modifiedCount === 1) {
    const draft = await collection.findOne({ tenantId, userId, revision: revision + 1 });
    if (draft) return { ok: true, draft };
  }
  const current = await collection.findOne({ tenantId, userId }, { projection: { revision: 1 } });
  return { ok: false, currentRevision: current?.revision ?? null };
}

export async function discardCampaignDraft(tenantId: string, userId: string, revision: number): Promise<boolean> {
  return discardCampaignDraftIn(await campaignDraftCollection(), tenantId, userId, revision);
}

export async function discardCampaignDraftIn(collection: Collection<CampaignDraftDoc>, tenantId: string, userId: string, revision: number): Promise<boolean> {
  const result = await collection.deleteOne({ tenantId, userId, revision });
  return result.deletedCount === 1;
}
