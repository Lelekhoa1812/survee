import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { col, withMongoTransaction } from "../db";
import { hashPassword } from "./accounts";
import type { MembershipDoc, TenantRole, UserDoc, WorkspaceInvitationDoc } from "./types";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function invitationHash(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

function objectId(value: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(value) ? new ObjectId(value) : null;
}

export interface AccountWorkspace {
  tenantId: string;
  name: string;
  role: TenantRole;
}

export async function listAccountWorkspaces(userId: string): Promise<AccountWorkspace[]> {
  const userObjectId = objectId(userId);
  if (!userObjectId) return [];
  const memberships = await (await col.memberships()).find({ userId: userObjectId }).sort({ createdAt: 1 }).toArray();
  if (!memberships.length) return [];
  const tenants = await (await col.tenants()).find({ _id: { $in: memberships.map((membership) => membership.tenantId) }, status: "active" }).toArray();
  const tenantById = new Map(tenants.map((tenant) => [tenant._id, tenant]));
  return memberships.flatMap((membership) => {
    const tenant = tenantById.get(membership.tenantId);
    return tenant ? [{ tenantId: tenant._id, name: tenant.name, role: membership.role }] : [];
  });
}

export async function rememberWorkspace(userId: string, tenantId: string): Promise<boolean> {
  const userObjectId = objectId(userId);
  if (!userObjectId || !tenantId || tenantId.length > 80) return false;
  const [membership, tenant] = await Promise.all([
    (await col.memberships()).findOne({ userId: userObjectId, tenantId }),
    (await col.tenants()).findOne({ _id: tenantId, status: "active" }, { projection: { _id: 1 } }),
  ]);
  if (!membership || !tenant) return false;
  const result = await (await col.users()).updateOne({ _id: userObjectId }, { $set: { lastTenantId: tenantId, updatedAt: new Date() } });
  return result.matchedCount === 1;
}

export async function createWorkspaceInvitation(input: {
  tenantId: string;
  invitedByUserId: string;
  email: string;
  role: "admin" | "member";
  messageId?: string;
}): Promise<{ ok: true; id: string; token: string; expiresAt: Date } | { ok: false; reason: "invalid" | "already_member" | "pending" }> {
  const inviterId = objectId(input.invitedByUserId);
  const email = normalizeEmail(input.email);
  if (!inviterId || !input.tenantId || !email || (input.role !== "admin" && input.role !== "member")) return { ok: false, reason: "invalid" };
  const [inviterMembership, tenant, existingUser] = await Promise.all([
    (await col.memberships()).findOne({ tenantId: input.tenantId, userId: inviterId, role: { $in: ["owner", "admin"] } }),
    (await col.tenants()).findOne({ _id: input.tenantId, status: "active" }, { projection: { _id: 1 } }),
    (await col.users()).findOne({ email }, { projection: { _id: 1 } }),
  ]);
  if (!inviterMembership || !tenant) return { ok: false, reason: "invalid" };
  if (existingUser && await (await col.memberships()).findOne({ tenantId: input.tenantId, userId: existingUser._id }, { projection: { _id: 1 } })) {
    return { ok: false, reason: "already_member" };
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const invitation: Omit<WorkspaceInvitationDoc, "_id"> = {
    tenantId: input.tenantId, email, role: input.role, invitedBy: inviterId,
    tokenHash: createHash("sha256").update(token).digest("hex"), createdAt: now,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    ...(input.messageId ? { messageId: input.messageId, mailStatus: "pending" as const } : {}),
  };
  const replaceable = {
    tenantId: input.tenantId,
    email,
    $or: [
      { expiresAt: { $lte: now } },
      { acceptedAt: { $exists: true } },
      { revokedAt: { $exists: true } },
    ],
  };
  try {
    await (await col.workspaceInvitations()).updateOne(
      replaceable,
      { $set: invitation, $unset: { acceptedAt: "", acceptedByUserId: "", revokedAt: "" } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    // Another request created or retained the active slot. Never rotate its
    // token here: its link may already have been delivered.
    const current = await (await col.workspaceInvitations()).findOne({
      tenantId: input.tenantId, email, expiresAt: { $gt: now },
      acceptedAt: { $exists: false }, revokedAt: { $exists: false },
    }, { projection: { _id: 1 } });
    if (current) return { ok: false, reason: "pending" };
    throw error;
  }
  const saved = await (await col.workspaceInvitations()).findOne({ tenantId: input.tenantId, email, tokenHash: invitation.tokenHash }, { projection: { _id: 1 } });
  if (!saved) throw new Error("Workspace invitation could not be reloaded.");
  return { ok: true, id: saved._id.toHexString(), token, expiresAt: invitation.expiresAt };
}

export async function updateWorkspaceInvitationMail(tenantId: string, invitationId: string, expectedMessageId: string, patch: {
  mailStatus?: "pending" | "sent";
  messageId?: string;
  delivery?: "delivered" | "bounced" | "unknown";
  deliveryCheckedAt?: Date;
  deliveryDetail?: string;
}): Promise<boolean> {
  const id = objectId(invitationId);
  if (!id || !tenantId) return false;
  const result = await (await col.workspaceInvitations()).updateOne(
    { _id: id, tenantId, messageId: expectedMessageId },
    { $set: patch },
  );
  return result.matchedCount === 1;
}

export async function getWorkspaceInvitationMail(tenantId: string, invitationId: string): Promise<{ id: string; messageId?: string; mailStatus?: "pending" | "sent" } | null> {
  const id = objectId(invitationId);
  if (!id || !tenantId) return null;
  const invitation = await (await col.workspaceInvitations()).findOne({ _id: id, tenantId }, { projection: { _id: 1, messageId: 1, mailStatus: 1 } });
  return invitation ? { id: invitation._id.toHexString(), messageId: invitation.messageId, mailStatus: invitation.mailStatus } : null;
}

export async function revokeWorkspaceInvitation(tenantId: string, invitationId: string): Promise<boolean> {
  const id = objectId(invitationId);
  if (!id || !tenantId) return false;
  const result = await (await col.workspaceInvitations()).updateOne(
    { _id: id, tenantId, expiresAt: { $gt: new Date() }, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}

export async function listWorkspaceAccess(tenantId: string): Promise<{
  members: { userId: string; email: string; role: TenantRole; createdAt: string }[];
  invitations: { id: string; email: string; role: "admin" | "member"; expiresAt: string; mailStatus?: "pending" | "sent"; delivery?: "delivered" | "bounced" | "unknown"; deliveryCheckedAt?: string; canCheckDelivery: boolean }[];
  ownerCount: number;
}> {
  if (!tenantId) return { members: [], invitations: [], ownerCount: 0 };
  const memberships = await (await col.memberships()).find({ tenantId }).sort({ createdAt: 1 }).toArray();
  const users = memberships.length
    ? await (await col.users()).find({ _id: { $in: memberships.map((membership) => membership.userId) } }, { projection: { email: 1 } }).toArray()
    : [];
  const userById = new Map(users.map((user) => [user._id.toHexString(), user]));
  const invitations = await (await col.workspaceInvitations()).find({
    tenantId, expiresAt: { $gt: new Date() }, acceptedAt: { $exists: false }, revokedAt: { $exists: false },
  }).sort({ createdAt: -1 }).toArray();
  return {
    ownerCount: memberships.filter((membership) => membership.role === "owner").length,
    members: memberships.flatMap((membership) => {
      const user = userById.get(membership.userId.toHexString());
      return user ? [{ userId: membership.userId.toHexString(), email: user.email, role: membership.role, createdAt: membership.createdAt.toISOString() }] : [];
    }),
    invitations: invitations.map((invitation) => ({
      id: invitation._id.toHexString(), email: invitation.email, role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(), mailStatus: invitation.mailStatus,
      delivery: invitation.delivery, deliveryCheckedAt: invitation.deliveryCheckedAt?.toISOString(),
      canCheckDelivery: !!invitation.messageId,
    })),
  };
}

export type RemoveWorkspaceMemberResult =
  | { ok: true; role: TenantRole }
  | { ok: false; reason: "invalid" | "forbidden" | "not_found" | "last_owner" };

export type TransferWorkspaceOwnershipResult =
  | { ok: true; previousOwnerUserId: string; newOwnerUserId: string }
  | { ok: false; reason: "invalid" | "forbidden" | "not_found" };

export type ChangeWorkspaceMemberRoleResult =
  | { ok: true; previousRole: "admin" | "member"; role: "admin" | "member" }
  | { ok: false; reason: "invalid" | "forbidden" | "not_found" | "owner_transfer_required" };

class WorkspaceMutationAbort extends Error {
  constructor(readonly result: unknown) { super("Workspace mutation did not complete."); }
}

async function returnAbortedWorkspaceMutation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof WorkspaceMutationAbort) return error.result as T;
    throw error;
  }
}

/** Change an existing non-owner's workspace role without revoking their membership. */
export async function changeWorkspaceMemberRole(input: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  role: "admin" | "member";
}): Promise<ChangeWorkspaceMemberRoleResult> {
  const actorId = objectId(input.actorUserId);
  const targetId = objectId(input.targetUserId);
  if (!input.tenantId || input.tenantId.length > 80 || !actorId || !targetId || (input.role !== "admin" && input.role !== "member")) return { ok: false, reason: "invalid" };

  return returnAbortedWorkspaceMutation(() => withMongoTransaction(async (session) => {
    const tenants = await col.tenants();
    const tenant = await tenants.findOne({ _id: input.tenantId, status: "active" }, { session, projection: { _id: 1 } });
    if (!tenant) return { ok: false, reason: "forbidden" };
    const memberships = await col.memberships();
    const actor = await memberships.findOne({ tenantId: input.tenantId, userId: actorId, role: "owner" }, { session });
    if (!actor) return { ok: false, reason: "forbidden" };
    const target = await memberships.findOne({ tenantId: input.tenantId, userId: targetId }, { session });
    if (!target) return { ok: false, reason: "not_found" };
    if (target.role === "owner") return { ok: false, reason: "owner_transfer_required" };
    if (target.role !== "admin" && target.role !== "member") return { ok: false, reason: "not_found" };
    if (target.role === input.role) return { ok: true, previousRole: target.role, role: input.role };
    const previousRole = target.role;

    // Serialize role edits with transfers/removals and their auth-state changes.
    const fenced = await tenants.updateOne(
      { _id: input.tenantId, status: "active" },
      { $inc: { membershipEpoch: 1 }, $set: { updatedAt: new Date() } },
      { session },
    );
    if (fenced.matchedCount !== 1) return { ok: false, reason: "forbidden" };
    const changed = await memberships.updateOne(
      { _id: target._id, tenantId: input.tenantId, userId: targetId, role: previousRole },
      { $set: { role: input.role } },
      { session },
    );
    if (changed.matchedCount !== 1) throw new WorkspaceMutationAbort({ ok: false, reason: "not_found" });
    await (await col.events()).insertOne({
      _id: new ObjectId(), tenantId: input.tenantId, type: "workspace_member_role_changed", at: new Date(),
      meta: { actorUserId: actorId.toHexString(), targetUserId: targetId.toHexString(), previousRole, role: input.role },
    }, { session });
    return { ok: true, previousRole, role: input.role };
  }));
}

/** Promote an existing member and leave the transferring owner as an admin. */
export async function transferWorkspaceOwnership(input: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<TransferWorkspaceOwnershipResult> {
  const actorId = objectId(input.actorUserId);
  const targetId = objectId(input.targetUserId);
  if (!input.tenantId || input.tenantId.length > 80 || !actorId || !targetId || actorId.equals(targetId)) return { ok: false, reason: "invalid" };

  return returnAbortedWorkspaceMutation(() => withMongoTransaction(async (session) => {
    const tenants = await col.tenants();
    const tenant = await tenants.findOne({ _id: input.tenantId, status: "active" }, { session, projection: { _id: 1 } });
    if (!tenant) return { ok: false, reason: "forbidden" };
    const memberships = await col.memberships();
    const actor = await memberships.findOne({ tenantId: input.tenantId, userId: actorId, role: "owner" }, { session });
    if (!actor) return { ok: false, reason: "forbidden" };
    const target = await memberships.findOne({ tenantId: input.tenantId, userId: targetId }, { session });
    if (!target) return { ok: false, reason: "not_found" };

    // This tenant write serializes transfers with owner removals and other
    // transfers, whose transactions update the same epoch before changing roles.
    const fenced = await tenants.updateOne(
      { _id: input.tenantId, status: "active" },
      { $inc: { membershipEpoch: 1 }, $set: { updatedAt: new Date() } },
      { session },
    );
    if (fenced.matchedCount !== 1) return { ok: false, reason: "forbidden" };
    const promoted = await memberships.updateOne(
      { _id: target._id, tenantId: input.tenantId, userId: targetId },
      { $set: { role: "owner" } },
      { session },
    );
    if (promoted.matchedCount !== 1) throw new WorkspaceMutationAbort({ ok: false, reason: "not_found" });
    const demoted = await memberships.updateOne(
      { _id: actor._id, tenantId: input.tenantId, userId: actorId, role: "owner" },
      { $set: { role: "admin" } },
      { session },
    );
    if (demoted.matchedCount !== 1) throw new Error("Workspace ownership changed during transfer.");
    await (await col.events()).insertOne({
      _id: new ObjectId(),
      tenantId: input.tenantId,
      type: "workspace_owner_transferred",
      at: new Date(),
      meta: { previousOwnerUserId: actorId.toHexString(), newOwnerUserId: targetId.toHexString() },
    }, { session });
    return { ok: true, previousOwnerUserId: actorId.toHexString(), newOwnerUserId: targetId.toHexString() };
  }));
}

/** Remove one membership in the current tenant; the account and other workspace memberships remain. */
export async function removeWorkspaceMember(input: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<RemoveWorkspaceMemberResult> {
  const actorId = objectId(input.actorUserId);
  const targetId = objectId(input.targetUserId);
  if (!input.tenantId || input.tenantId.length > 80 || !actorId || !targetId) return { ok: false, reason: "invalid" };

  return returnAbortedWorkspaceMutation(() => withMongoTransaction(async (session) => {
    const tenant = await (await col.tenants()).findOne({ _id: input.tenantId, status: "active" }, { session, projection: { _id: 1 } });
    if (!tenant) return { ok: false, reason: "forbidden" };
    const memberships = await col.memberships();
    const actor = await memberships.findOne({ tenantId: input.tenantId, userId: actorId }, { session });
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) return { ok: false, reason: "forbidden" };
    const target = await memberships.findOne({ tenantId: input.tenantId, userId: targetId }, { session });
    if (!target) return { ok: false, reason: "not_found" };
    if (target.role === "owner") {
      if (actor.role !== "owner") return { ok: false, reason: "forbidden" };
      const owners = await memberships.find({ tenantId: input.tenantId, role: "owner" }, { session, projection: { _id: 1 } }).toArray();
      if (owners.length <= 1) return { ok: false, reason: "last_owner" };
      // Competing owner-removal transactions write this tenant row. Mongo retries
      // a write-conflicted transaction against a fresh snapshot before rechecking.
      const fenced = await (await col.tenants()).updateOne(
        { _id: input.tenantId, status: "active" },
        { $inc: { membershipEpoch: 1 }, $set: { updatedAt: new Date() } },
        { session },
      );
      if (fenced.matchedCount !== 1) throw new WorkspaceMutationAbort({ ok: false, reason: "forbidden" });
    }
    const deleted = await memberships.deleteOne(
      { _id: target._id, tenantId: input.tenantId, userId: targetId },
      { session },
    );
    if (deleted.deletedCount !== 1) throw new WorkspaceMutationAbort({ ok: false, reason: "not_found" });
    await (await col.events()).insertOne({
      _id: new ObjectId(),
      tenantId: input.tenantId,
      type: "workspace_member_removed",
      at: new Date(),
      meta: { actorUserId: actorId.toHexString(), targetUserId: targetId.toHexString(), role: target.role },
    }, { session });
    return { ok: true, role: target.role };
  }));
}

export async function getWorkspaceInvitation(token: string): Promise<{ tenantId: string; tenantName: string; email: string; role: "admin" | "member"; expiresAt: string } | null> {
  const tokenHash = invitationHash(token);
  if (!tokenHash) return null;
  const invitation = await (await col.workspaceInvitations()).findOne({
    tokenHash, expiresAt: { $gt: new Date() }, acceptedAt: { $exists: false }, revokedAt: { $exists: false },
  });
  if (!invitation) return null;
  const tenant = await (await col.tenants()).findOne({ _id: invitation.tenantId, status: "active" }, { projection: { name: 1 } });
  return tenant ? { tenantId: tenant._id, tenantName: tenant.name, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() } : null;
}

export type AcceptWorkspaceInvitationResult = { ok: true; tenantId: string } | { ok: false; reason: "invalid" | "email_mismatch" | "account_required" };

class InvitationTransactionAbort extends Error {
  constructor(readonly result: AcceptWorkspaceInvitationResult | CreateInvitedAccountResult) { super("Invitation claim rejected."); }
}

export async function acceptWorkspaceInvitation(token: string, userId: string, emailInput: string): Promise<AcceptWorkspaceInvitationResult> {
  const tokenHash = invitationHash(token);
  const userObjectId = objectId(userId);
  if (!tokenHash || !userObjectId) return { ok: false, reason: "invalid" };
  const email = normalizeEmail(emailInput);
  try {
    return await withMongoTransaction(async (session) => {
    const invitations = await col.workspaceInvitations();
    const invitation = await invitations.findOne({ tokenHash, revokedAt: { $exists: false } }, { session });
    if (!invitation) return { ok: false, reason: "invalid" as const };
    if (invitation.email !== email) return { ok: false, reason: "email_mismatch" as const };
    const users = await col.users();
    const user = await users.findOne({ _id: userObjectId, email }, { session });
    const tenant = await (await col.tenants()).findOne({ _id: invitation.tenantId, status: "active" }, { session });
    if (!user || !(user.emailVerifiedAt || user.legacyBootstrap) || !tenant) return { ok: false, reason: "account_required" as const };
    const memberships = await col.memberships();
    let membership = await memberships.findOne({ tenantId: invitation.tenantId, userId: userObjectId }, { session });
    if (invitation.acceptedAt) {
      if (invitation.expiresAt <= new Date() || !invitation.acceptedByUserId?.equals(userObjectId) || !membership) return { ok: false, reason: "invalid" as const };
      await users.updateOne({ _id: userObjectId }, { $set: { lastTenantId: invitation.tenantId, updatedAt: new Date() } }, { session });
      return { ok: true, tenantId: invitation.tenantId } as const;
    }
    if (invitation.expiresAt <= new Date()) return { ok: false, reason: "invalid" as const };
    if (!membership) {
      membership = { _id: new ObjectId(), tenantId: invitation.tenantId, userId: userObjectId, role: invitation.role, createdAt: new Date() };
      await memberships.insertOne(membership, { session });
    }
    const now = new Date();
    const claimed = await invitations.updateOne(
      { _id: invitation._id, tokenHash, expiresAt: { $gt: now }, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { acceptedAt: now, acceptedByUserId: userObjectId } }, { session },
    );
    if (!claimed.modifiedCount) throw new InvitationTransactionAbort({ ok: false, reason: "invalid" });
    await users.updateOne({ _id: userObjectId }, { $set: { lastTenantId: invitation.tenantId, updatedAt: now } }, { session });
    return { ok: true, tenantId: invitation.tenantId } as const;
    });
  } catch (error) {
    if (error instanceof InvitationTransactionAbort) return error.result as AcceptWorkspaceInvitationResult;
    throw error;
  }
}

export type CreateInvitedAccountResult = { ok: true; userId: string; tenantId: string } | { ok: false; reason: "invalid" | "account_exists" };

export async function createInvitedAccount(token: string, password: string): Promise<CreateInvitedAccountResult> {
  const tokenHash = invitationHash(token);
  if (!tokenHash || password.length < 8 || password.length > 200) return { ok: false, reason: "invalid" };
  const invitation = await (await col.workspaceInvitations()).findOne({
    tokenHash, expiresAt: { $gt: new Date() }, acceptedAt: { $exists: false }, revokedAt: { $exists: false },
  });
  if (!invitation) return { ok: false, reason: "invalid" };
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const userId = new ObjectId();
  try {
      return await withMongoTransaction(async (session) => {
      const invitations = await col.workspaceInvitations();
      const current = await invitations.findOne({
        _id: invitation._id, tokenHash, expiresAt: { $gt: new Date() }, acceptedAt: { $exists: false }, revokedAt: { $exists: false },
      }, { session });
      if (!current) return { ok: false, reason: "invalid" as const };
      const tenant = await (await col.tenants()).findOne({ _id: current.tenantId, status: "active" }, { session });
      if (!tenant) return { ok: false, reason: "invalid" as const };
      const users = await col.users();
      if (await users.findOne({ email: current.email }, { projection: { _id: 1 }, session })) return { ok: false, reason: "account_exists" as const };
      const user: UserDoc = {
        _id: userId, email: current.email, passwordHash, emailVerifiedAt: now, lastTenantId: current.tenantId,
        createdAt: now, updatedAt: now,
      };
      await users.insertOne(user, { session });
      await (await col.memberships()).insertOne({
        _id: new ObjectId(), tenantId: current.tenantId, userId, role: current.role, createdAt: now,
      }, { session });
      const claimed = await invitations.updateOne(
        { _id: current._id, tokenHash, expiresAt: { $gt: now }, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
        { $set: { acceptedAt: now, acceptedByUserId: userId } }, { session },
      );
      if (!claimed.modifiedCount) throw new InvitationTransactionAbort({ ok: false, reason: "invalid" });
      return { ok: true, userId: userId.toHexString(), tenantId: current.tenantId } as const;
    });
  } catch (error) {
    if (error instanceof InvitationTransactionAbort) return error.result as CreateInvitedAccountResult;
    if ((error as { code?: number }).code === 11000 && await (await col.users()).findOne({ email: invitation.email }, { projection: { _id: 1 } })) {
      return { ok: false, reason: "account_exists" };
    }
    throw error;
  }
}

export async function revokeWorkspaceInvitationByToken(tenantId: string, token: string): Promise<void> {
  const tokenHash = invitationHash(token);
  if (!tokenHash) return;
  await (await col.workspaceInvitations()).updateOne(
    { tenantId, tokenHash, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}
