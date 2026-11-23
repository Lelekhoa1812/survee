import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import {
  MAX_ANALYTICS_MINIMUM_CELL_SIZE,
  MIN_ANALYTICS_MINIMUM_CELL_SIZE,
  getWorkspacePolicy,
  updateWorkspacePolicy,
  type RespondentPolicyInput,
} from "@/lib/repo/workspace-policy";

const POLICY_FIELDS = ["notice", "purpose", "retention", "contact", "withdrawal"] as const;
const FIELD_LIMITS: Record<(typeof POLICY_FIELDS)[number], number> = {
  notice: 5000, purpose: 1000, retention: 1000, contact: 500, withdrawal: 1000,
};

export const GET = withServerErrors("admin/workspace-policy", async function GET() {
  const denied = await guardAdmin({ roles: ["owner"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const policy = await getWorkspacePolicy(session.tenantId);
  return policy ? json({ ok: true, policy }) : fail(404, "Workspace not found.");
});

export const PATCH = withServerErrors("admin/workspace-policy", async function PATCH(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<Record<string, unknown>>(req, 16 * 1024);
  if (!body.ok) return body.res;
  if (Object.keys(body.data).some((key) => key !== "analyticsMinimumCellSize" && key !== "respondentPolicy")) return fail(400, "The workspace policy contains an unsupported field.");

  let analyticsMinimumCellSize: number | undefined;
  if (Object.hasOwn(body.data, "analyticsMinimumCellSize")) {
    const value = body.data.analyticsMinimumCellSize;
    if (!Number.isInteger(value) || (value as number) < MIN_ANALYTICS_MINIMUM_CELL_SIZE || (value as number) > MAX_ANALYTICS_MINIMUM_CELL_SIZE) {
      return fail(400, `Minimum cell size must be a whole number from ${MIN_ANALYTICS_MINIMUM_CELL_SIZE} to ${MAX_ANALYTICS_MINIMUM_CELL_SIZE}.`);
    }
    analyticsMinimumCellSize = value as number;
  }

  let respondentPolicy: RespondentPolicyInput | null | undefined;
  if (Object.hasOwn(body.data, "respondentPolicy")) {
    const value = body.data.respondentPolicy;
    if (value === null) respondentPolicy = null;
    else {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(400, "Enter a workspace policy object or clear the policy.");
      const policy = value as Record<string, unknown>;
      if (Object.keys(policy).some((key) => !(POLICY_FIELDS as readonly string[]).includes(key))) return fail(400, "The workspace policy contains an unsupported field.");
      const parsed: Record<string, string> = {};
      for (const field of POLICY_FIELDS) {
        const text = policy[field];
        if (text !== undefined && typeof text !== "string") return fail(400, "Workspace policy fields must be text.");
        const clean = typeof text === "string" ? text.trim() : "";
        if (clean.length > FIELD_LIMITS[field]) return fail(400, `${field} is too long (maximum ${FIELD_LIMITS[field]} characters).`);
        parsed[field] = clean;
      }
      if (!POLICY_FIELDS.some((field) => parsed[field])) respondentPolicy = null;
      else respondentPolicy = parsed as RespondentPolicyInput;
    }
  }
  if (analyticsMinimumCellSize === undefined && respondentPolicy === undefined) return fail(400, "Change at least one workspace policy setting.");
  const policy = await updateWorkspacePolicy({ tenantId: session.tenantId, actorUserId: session.userId, analyticsMinimumCellSize, respondentPolicy });
  return policy ? json({ ok: true, policy }) : fail(404, "Workspace not found.");
});
