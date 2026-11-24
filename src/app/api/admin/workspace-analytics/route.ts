import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import {
  MAX_ANALYTICS_MINIMUM_CELL_SIZE,
  MIN_ANALYTICS_MINIMUM_CELL_SIZE,
  getWorkspaceAnalytics,
  updateWorkspaceAnalytics,
} from "@/lib/repo/workspace-analytics";

export const GET = withServerErrors("admin/workspace-analytics", async function GET() {
  const denied = await guardAdmin({ roles: ["owner"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const settings = await getWorkspaceAnalytics(session.tenantId);
  return settings ? json({ ok: true, settings }) : fail(404, "Workspace not found.");
});

export const PATCH = withServerErrors("admin/workspace-analytics", async function PATCH(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<Record<string, unknown>>(req, 1024);
  if (!body.ok) return body.res;
  if (Object.keys(body.data).some((key) => key !== "analyticsMinimumCellSize")) return fail(400, "The workspace analytics settings contain an unsupported field.");

  const value = body.data.analyticsMinimumCellSize;
  if (!Number.isInteger(value) || (value as number) < MIN_ANALYTICS_MINIMUM_CELL_SIZE || (value as number) > MAX_ANALYTICS_MINIMUM_CELL_SIZE) {
    return fail(400, `Minimum cell size must be a whole number from ${MIN_ANALYTICS_MINIMUM_CELL_SIZE} to ${MAX_ANALYTICS_MINIMUM_CELL_SIZE}.`);
  }
  const settings = await updateWorkspaceAnalytics({ tenantId: session.tenantId, actorUserId: session.userId, analyticsMinimumCellSize: value as number });
  return settings ? json({ ok: true, settings }) : fail(404, "Workspace not found.");
});
