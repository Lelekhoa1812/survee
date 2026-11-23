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

export type RespondentPolicyInput = {
  notice: string;
  purpose: string;
  retention: string;
  contact: string;
  withdrawal: string;
};

export type WorkspacePolicyView = {
  analyticsMinimumCellSize: number;
  respondentPolicy: (RespondentPolicyInput & { revision: number; updatedAt: string }) | null;
};

function toView(tenant: TenantDoc): WorkspacePolicyView {
  const policy = tenant.respondentPolicy;
  const hasPolicyText = !!policy && [policy.notice, policy.purpose, policy.retention, policy.contact, policy.withdrawal].some((value) => !!value?.trim());
  return {
    analyticsMinimumCellSize: tenant.analyticsMinimumCellSize ?? DEFAULT_ANALYTICS_MINIMUM_CELL_SIZE,
    respondentPolicy: hasPolicyText && policy ? {
      notice: policy.notice ?? "",
      purpose: policy.purpose ?? "",
      retention: policy.retention ?? "",
      contact: policy.contact ?? "",
      withdrawal: policy.withdrawal ?? "",
      revision: policy.revision,
      updatedAt: policy.updatedAt.toISOString(),
    } : null,
  };
}

export async function getWorkspacePolicy(tenantId: string): Promise<WorkspacePolicyView | null> {
  if (!tenantId) return null;
  const tenant = await (await col.tenants()).findOne({ _id: tenantId, status: "active" });
  return tenant ? toView(tenant) : null;
}

export async function updateWorkspacePolicy(input: {
  tenantId: string;
  actorUserId: string;
  analyticsMinimumCellSize?: number;
  respondentPolicy?: RespondentPolicyInput | null;
}): Promise<WorkspacePolicyView | null> {
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
    let policyRevision: number | undefined;
    if (input.respondentPolicy !== undefined) {
      if (input.respondentPolicy === null) {
        const hasPolicyText = !!tenant.respondentPolicy && [tenant.respondentPolicy.notice, tenant.respondentPolicy.purpose, tenant.respondentPolicy.retention, tenant.respondentPolicy.contact, tenant.respondentPolicy.withdrawal].some((value) => !!value?.trim());
        if (hasPolicyText) {
          changed.push("respondentPolicy");
          policyRevision = (tenant.respondentPolicy?.revision ?? 0) + 1;
          set.respondentPolicy = {
            notice: "", purpose: "", retention: "", contact: "", withdrawal: "",
            revision: policyRevision, updatedAt: new Date(), updatedBy: actorId.toHexString(),
          };
        }
      } else {
        const previous = tenant.respondentPolicy;
        const same = previous && ["notice", "purpose", "retention", "contact", "withdrawal"]
          .every((field) => (previous[field as keyof typeof previous] ?? "") === input.respondentPolicy![field as keyof RespondentPolicyInput]);
        if (!same) {
          policyRevision = (previous?.revision ?? 0) + 1;
          set.respondentPolicy = {
            ...input.respondentPolicy,
            revision: policyRevision,
            updatedAt: new Date(),
            updatedBy: actorId.toHexString(),
          };
          changed.push("respondentPolicy");
        }
      }
    }
    if (!changed.length) return toView(tenant);
    const update = { $set: set };
    const result = await tenants.updateOne({ _id: tenant._id, status: "active" }, update, { session });
    if (result.modifiedCount !== 1) return null;
    await (await col.events()).insertOne({
      _id: new ObjectId(), tenantId: input.tenantId, type: "workspace_policy_updated", at: new Date(),
      meta: { actorUserId: actorId.toHexString(), changed, ...(policyRevision === undefined ? {} : { policyRevision }), ...(input.analyticsMinimumCellSize === undefined ? {} : { analyticsMinimumCellSize: input.analyticsMinimumCellSize }) },
    }, { session });
    const saved = await tenants.findOne({ _id: input.tenantId }, { session });
    return saved ? toView(saved) : null;
  });
}
