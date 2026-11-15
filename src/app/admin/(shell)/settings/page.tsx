import { SettingsConsole } from "@/components/SettingsConsole";
import { AccountSettingsPanel } from "@/components/AccountSettingsPanel";
import { db } from "@/lib/db";
import { adminSession } from "@/lib/http";
import { mcpToken, publicBaseUrl } from "@/lib/env";
import { listApiKeys } from "@/lib/repo/keys";
import { auditTenantMigration } from "@/lib/tenant-migration";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await adminSession();
  const canManageKeys = session?.role === "owner" || session?.role === "admin";
  let keys = null;
  let loadError = false;
  if (canManageKeys) {
    try {
      keys = await listApiKeys();
    } catch {
      loadError = true;
    }
  }
  let tenantAudit: Awaited<ReturnType<typeof auditTenantMigration>> | null = null;
  let tenantAuditError = false;
  const mayManageLegacy = session?.tenantId === "axion" && session.role === "owner";
  if (mayManageLegacy) {
    try {
      tenantAudit = await auditTenantMigration(await db());
    } catch {
      tenantAuditError = true;
    }
  }
  const origin = publicBaseUrl();
  const account = session ? {
    tenantName: session.tenantName,
    email: session.email,
    role: session.role,
    emailVerified: session.emailVerified,
    legacyBootstrap: session.legacyBootstrap,
  } : null;
  return <SettingsConsole initialKeys={keys} loadError={loadError} canManageKeys={canManageKeys} envToken={mcpToken() !== null} origin={origin.ok ? origin.origin : null} tenantAudit={tenantAudit} tenantAuditError={tenantAuditError} mayManageLegacy={mayManageLegacy} account={account} />;
}
