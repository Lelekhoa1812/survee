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
}): Promise<{ ok: true; token: string; expiresAt: Date } | { ok: false; reason: "invalid" | "already_member" }> {
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
  };
  try {
    await (await col.workspaceInvitations()).updateOne(
      { tenantId: input.tenantId, email },
      { $set: invitation, $unset: { acceptedAt: "", acceptedByUserId: "", revokedAt: "" } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    // A concurrent invitation won the unique workspace/email slot. Replace its
    // token atomically so only the most recently sent link remains valid.
    await (await col.workspaceInvitations()).updateOne(
      { tenantId: input.tenantId, email },
      { $set: invitation, $unset: { acceptedAt: "", acceptedByUserId: "", revokedAt: "" } },
    );
  }
  return { ok: true, token, expiresAt: invitation.expiresAt };
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
  invitations: { id: string; email: string; role: "admin" | "member"; expiresAt: string }[];
}> {
  if (!tenantId) return { members: [], invitations: [] };
  const memberships = await (await col.memberships()).find({ tenantId }).sort({ createdAt: 1 }).toArray();
  const users = memberships.length
    ? await (await col.users()).find({ _id: { $in: memberships.map((membership) => membership.userId) } }, { projection: { email: 1 } }).toArray()
    : [];
  const userById = new Map(users.map((user) => [user._id.toHexString(), user]));
  const invitations = await (await col.workspaceInvitations()).find({
    tenantId, expiresAt: { $gt: new Date() }, acceptedAt: { $exists: false }, revokedAt: { $exists: false },
  }).sort({ createdAt: -1 }).toArray();
  return {
    members: memberships.flatMap((membership) => {
      const user = userById.get(membership.userId.toHexString());
      return user ? [{ userId: membership.userId.toHexString(), email: user.email, role: membership.role, createdAt: membership.createdAt.toISOString() }] : [];
    }),
    invitations: invitations.map((invitation) => ({ id: invitation._id.toHexString(), email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() })),
  };
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

export async function acceptWorkspaceInvitation(token: string, userId: string, emailInput: string): Promise<AcceptWorkspaceInvitationResult> {
  const tokenHash = invitationHash(token);
  const userObjectId = objectId(userId);
  if (!tokenHash || !userObjectId) return { ok: false, reason: "invalid" };
  const email = normalizeEmail(emailInput);
  return withMongoTransaction(async (session) => {
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
    if (!claimed.modifiedCount) return { ok: false, reason: "invalid" as const };
    await users.updateOne({ _id: userObjectId }, { $set: { lastTenantId: invitation.tenantId, updatedAt: now } }, { session });
    return { ok: true, tenantId: invitation.tenantId } as const;
  });
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
      if (!claimed.modifiedCount) return { ok: false, reason: "invalid" as const };
      return { ok: true, userId: userId.toHexString(), tenantId: current.tenantId } as const;
    });
  } catch (error) {
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
