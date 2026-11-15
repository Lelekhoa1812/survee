import { col } from "../db";

/** Tenant-bound credentials must stop working when their workspace is suspended or removed. */
export async function isTenantActive(tenantId: string): Promise<boolean> {
  return !!await (await col.tenants()).findOne({ _id: tenantId, status: "active" }, { projection: { _id: 1 } });
}
