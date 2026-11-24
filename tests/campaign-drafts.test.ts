import { describe, expect, it } from "vitest";
import type { Collection } from "mongodb";
import type { CampaignDraftDoc } from "@/lib/repo/types";
import { discardCampaignDraftIn, saveCampaignDraftIn, validateCampaignDraft } from "@/lib/campaign-drafts";

function memoryCollection(): Collection<CampaignDraftDoc> {
  const rows = new Map<string, CampaignDraftDoc>();
  const key = (tenantId: string, userId: string) => `${tenantId}/${userId}`;
  return {
    async insertOne(doc: CampaignDraftDoc) {
      const k = key(doc.tenantId, doc.userId);
      if (rows.has(k)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      rows.set(k, doc);
      return { acknowledged: true, insertedId: doc._id };
    },
    async findOne(filter: Record<string, unknown>) {
      const row = rows.get(key(String(filter.tenantId), String(filter.userId)));
      return row && (filter.revision === undefined || row.revision === filter.revision) ? row : null;
    },
    async updateOne(filter: Record<string, unknown>, update: Record<string, any>) {
      const row = rows.get(key(String(filter.tenantId), String(filter.userId)));
      if (!row || row.revision !== filter.revision) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
      Object.assign(row, update.$set, { revision: row.revision + update.$inc.revision });
      for (const property of Object.keys(update.$unset ?? {})) delete (row as unknown as Record<string, unknown>)[property];
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
    },
    async deleteOne(filter: Record<string, unknown>) {
      const k = key(String(filter.tenantId), String(filter.userId));
      const row = rows.get(k);
      if (!row || row.revision !== filter.revision) return { acknowledged: true, deletedCount: 0 };
      rows.delete(k);
      return { acknowledged: true, deletedCount: 1 };
    },
  } as unknown as Collection<CampaignDraftDoc>;
}

const input = { name: "Planning", description: "", mode: "single" as const, html: "<html></html>", fileName: "draft.html" };

describe("campaign composition drafts", () => {
  it("validates bounded draft fields and questionnaire size", () => {
    expect(validateCampaignDraft(input)).toEqual(input);
    expect(validateCampaignDraft({ ...input, name: "x".repeat(121) })).toBeNull();
    expect(validateCampaignDraft({ ...input, html: "x".repeat(3 * 1024 * 1024 + 1) })).toBeNull();
    expect(validateCampaignDraft({ ...input, mode: "invalid" })).toBeNull();
  });

  it("isolates draft slots by workspace and actor and stores no respondent entity references", async () => {
    const collection = memoryCollection();
    const saved = await saveCampaignDraftIn(collection, "workspace-a", "user-a", 0, input);
    const otherActor = await saveCampaignDraftIn(collection, "workspace-a", "user-b", 0, input);
    const otherWorkspace = await saveCampaignDraftIn(collection, "workspace-b", "user-a", 0, input);
    expect(saved.ok && saved.draft.tenantId).toBe("workspace-a");
    expect(otherActor.ok && otherActor.draft.userId).toBe("user-b");
    expect(otherWorkspace.ok && otherWorkspace.draft.tenantId).toBe("workspace-b");
    if (saved.ok) {
      expect(saved.draft).not.toHaveProperty("interviewId");
      expect(saved.draft).not.toHaveProperty("participantId");
      expect(saved.draft).not.toHaveProperty("token");
    }
  });

  it("allows only one initial writer and rejects stale revisions and stale discard", async () => {
    const collection = memoryCollection();
    const initial = await Promise.all([
      saveCampaignDraftIn(collection, "workspace-a", "user-a", 0, input),
      saveCampaignDraftIn(collection, "workspace-a", "user-a", 0, { ...input, name: "Other" }),
    ]);
    expect(initial.filter((result) => result.ok)).toHaveLength(1);
    const current = initial.find((result) => result.ok);
    expect(current?.ok && current.draft.revision).toBe(1);
    const next = await saveCampaignDraftIn(collection, "workspace-a", "user-a", 1, input);
    expect(next.ok && next.draft.revision).toBe(2);
    expect(await saveCampaignDraftIn(collection, "workspace-a", "user-a", 1, input)).toMatchObject({ ok: false, currentRevision: 2 });
    expect(await discardCampaignDraftIn(collection, "workspace-a", "user-a", 1)).toBe(false);
    expect(await discardCampaignDraftIn(collection, "workspace-a", "user-a", 2)).toBe(true);
  });

  it("clears questionnaire content when an existing draft removes its file", async () => {
    const collection = memoryCollection();
    const initial = await saveCampaignDraftIn(collection, "workspace-a", "user-a", 0, input);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const updated = await saveCampaignDraftIn(collection, "workspace-a", "user-a", initial.draft.revision, { name: "Planning", description: "", mode: "single" });
    expect(updated.ok && updated.draft).toMatchObject({ name: "Planning", revision: 2 });
    expect(updated.ok && updated.draft.html).toBeUndefined();
    expect(updated.ok && updated.draft.fileName).toBeUndefined();
  });
});
