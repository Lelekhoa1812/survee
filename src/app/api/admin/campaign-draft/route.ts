import { discardCampaignDraft, getCampaignDraft, saveCampaignDraft, validateCampaignDraft } from "@/lib/campaign-drafts";
import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import { LIMITS } from "@/lib/format/schema";

const roles = ["owner", "admin"] as const;

export const GET = withServerErrors("admin/campaign-draft", async function GET() {
  const denied = await guardAdmin({ roles });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const draft = await getCampaignDraft(session.tenantId, session.userId);
  if (!draft) return json({ ok: true, draft: null });
  return json({ ok: true, draft: { revision: draft.revision, name: draft.name, description: draft.description, mode: draft.mode, html: draft.html, fileName: draft.fileName, updatedAt: draft.updatedAt.toISOString() } });
});

export const PUT = withServerErrors("admin/campaign-draft", async function PUT(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles });
  if (denied) return denied;
  const body = await readJson<{ expectedRevision?: unknown; draft?: unknown }>(req, LIMITS.maxFileBytes * 6 + 128 * 1024);
  if (!body.ok) return body.res;
  const revision = body.data.expectedRevision;
  const input = validateCampaignDraft(body.data.draft);
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || !input) return fail(400, "The draft fields or revision are invalid.", { code: "invalid_args" });
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const result = await saveCampaignDraft(session.tenantId, session.userId, revision as number, input);
  if (!result.ok) return fail(409, "This draft changed in another tab. Reload the saved draft before continuing.", { code: "draft_conflict", currentRevision: result.currentRevision });
  return json({ ok: true, revision: result.draft.revision, updatedAt: result.draft.updatedAt.toISOString() });
});

export const DELETE = withServerErrors("admin/campaign-draft", async function DELETE(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles });
  if (denied) return denied;
  const body = await readJson<{ expectedRevision?: unknown }>(req, 1024);
  if (!body.ok) return body.res;
  const revision = body.data.expectedRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) return fail(400, "The draft revision is invalid.", { code: "invalid_args" });
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const removed = await discardCampaignDraft(session.tenantId, session.userId, revision as number);
  return removed ? json({ ok: true }) : fail(409, "This draft changed in another tab. Reload the saved draft before discarding it.", { code: "draft_conflict" });
});
