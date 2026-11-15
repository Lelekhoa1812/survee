import { db } from "@/lib/db";
import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { adminSession } from "@/lib/http";
import { auditTenantMigration, backfillLegacyTenant } from "@/lib/tenant-migration";

export async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;
  const session = await adminSession();
  if (!session || session.role !== "owner") return fail(403, "Only the workspace owner can review tenant migration.");
  try {
    return json({ ok: true, audit: await auditTenantMigration(await db()) });
  } catch {
    return fail(503, "The migration audit could not reach the database.");
  }
}

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const session = await adminSession();
  if (!session || session.role !== "owner") return fail(403, "Only the workspace owner can assign the legacy data.");
  const body = await readJson<{ confirmation?: unknown; backupConfirmed?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  if (str(body.data.confirmation, 80) !== "ASSIGN LEGACY DATA TO AXION") return fail(400, "Type the confirmation phrase exactly.");
  if (body.data.backupConfirmed !== true) return fail(400, "Verify a current database backup before assigning legacy records.");
  try {
    const modified = await backfillLegacyTenant(await db());
    return json({ ok: true, modified, audit: await auditTenantMigration(await db()) });
  } catch (error) {
    const message = error instanceof Error && error.message === "Tenant preflight is not ready; no records were changed."
      ? error.message
      : "The migration did not finish. It is safe to review the counts and retry after checking the database.";
    return fail(409, message);
  }
}
