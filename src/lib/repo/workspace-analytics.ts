import { ObjectId } from "mongodb";
import {
  DEFAULT_ANALYTICS_MIN_CELL_SIZE as DEFAULT_DISCLOSURE_MINIMUM,
  MAX_ANALYTICS_MIN_CELL_SIZE as MAX_DISCLOSURE_MINIMUM,
  MIN_ANALYTICS_MIN_CELL_SIZE as MIN_DISCLOSURE_MINIMUM,
} from "../analytics/disclosure";
import { col, withMongoTransaction } from "../db";
import type { TenantDoc } from "./types";

export const DEFAULT_ANALYTICS_MINIMUM_CELL_SIZE = DEFAULT_DISCLOSURE_MINIMUM;
export const MIN_ANALYTICS_MINIMUM_CELL_SIZE = MIN_DISCLOSURE_MINIMUM;
export const MAX_ANALYTICS_MINIMUM_CELL_SIZE = MAX_DISCLOSURE_MINIMUM;

export type WorkspaceAnalyticsView = {
  analyticsMinimumCellSize: number;
};

function toView(tenant: TenantDoc): WorkspaceAnalyticsView {
  return { analyticsMinimumCellSize: tenant.analyticsMinimumCellSize ?? DEFAULT_ANALYTICS_MINIMUM_CELL_SIZE };
}

export async function getWorkspaceAnalytics(tenantId: string): Promise<WorkspaceAnalyticsView | null> {
  if (!tenantId) return null;
  const tenant = await (await col.tenants()).findOne({ _id: tenantId, status: "active" });
  return tenant ? toView(tenant) : null;
}

export async function updateWorkspaceAnalytics(input: {
  tenantId: string;
  actorUserId: string;
  analyticsMinimumCellSize?: number;
}): Promise<WorkspaceAnalyticsView | null> {
  if (!input.tenantId || !/^[a-f\d]{24}$/i.test(input.actorUserId)) return null;
  const actorId = new ObjectId(input.actorUserId);
  return withMongoTransaction(async (session) => {
    const tenants = await col.tenants();
    const tenant = await tenants.findOne({ _id: input.tenantId, status: "active" }, { session });
    if (!tenant) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const changed: string[] = [];
    if (input.analyticsMinimumCellSize !== undefined && input.analyticsMinimumCellSize !== tenant.analyticsMinimumCellSize) {
      set.analyticsMinimumCellSize = input.analyticsMinimumCellSize;
      changed.push("analyticsMinimumCellSize");
    }
    if (!changed.length) return toView(tenant);
    const update = { $set: set };
    const result = await tenants.updateOne({ _id: tenant._id, status: "active" }, update, { session });
    if (result.modifiedCount !== 1) return null;
    await (await col.events()).insertOne({
      _id: new ObjectId(), tenantId: input.tenantId, type: "workspace_analytics_updated", at: new Date(),
      meta: { actorUserId: actorId.toHexString(), changed, ...(input.analyticsMinimumCellSize === undefined ? {} : { analyticsMinimumCellSize: input.analyticsMinimumCellSize }) },
    }, { session });
    const saved = await tenants.findOne({ _id: input.tenantId }, { session });
    return saved ? toView(saved) : null;
  });
}
