import { createHash, randomBytes, timingSafeEqual, scrypt } from "node:crypto";
import { ObjectId } from "mongodb";
import { AXION_OWNER_EMAIL, AXION_TENANT_ID, adminConfig } from "../env";
import { col } from "../db";
import type { MembershipDoc, PendingEmailChangeDoc, PendingPasswordResetDoc, PendingSignupDoc, TenantDoc, TenantRole, UserDoc } from "./types";

const PASSWORD_BYTES = 64;
const SCRYPT_N = 16_384;
const SIGNUP_TTL_MS = 30 * 60 * 1000;
const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export interface AccountPrincipal {
  userId: string;
  tenantId: string;
  email: string;
  role: TenantRole;
  tenantName: string;
  emailVerified: boolean;
  legacyBootstrap: boolean;
  authVersion: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_BYTES, { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT_N}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, salt, expectedText] = encoded.split("$");
  if (algorithm !== "scrypt" || cost !== String(SCRYPT_N) || !salt || !expectedText) return false;
  try {
    const expected = Buffer.from(expectedText, "base64url");
    const actual = await derive(password, salt);
    return expected.length === PASSWORD_BYTES && safeEqual(actual, expected);
  } catch {
    return false;
  }
}

function accountPrincipal(user: UserDoc, membership: MembershipDoc, tenant: TenantDoc): AccountPrincipal {
  return {
    userId: user._id.toHexString(), tenantId: membership.tenantId, email: user.email, role: membership.role,
    tenantName: tenant.name, emailVerified: !!user.emailVerifiedAt, legacyBootstrap: !!user.legacyBootstrap,
    authVersion: user.authVersion ?? 0,
  };
}

export async function authenticateAccount(emailInput: string, password: string): Promise<AccountPrincipal | null> {
  const email = normalizeEmail(emailInput);
  const user = await (await col.users()).findOne({ email });
  if (!user || !(user.emailVerifiedAt || user.legacyBootstrap)) return null;
  const passwordMatches = await verifyPassword(password, user.passwordHash);
  const membership = await (await col.memberships()).findOne({ userId: user._id });
  if (!membership) return null;
  const tenant = await (await col.tenants()).findOne({ _id: membership.tenantId, status: "active" });
  if (!tenant) return null;
  if (!passwordMatches) return null;
  return accountPrincipal(user, membership, tenant);
}

/** Resolve a signed session against persisted membership state so removed users lose access immediately. */
export async function loadAccountPrincipal(userId: string, tenantId: string): Promise<AccountPrincipal | null> {
  if (!/^[0-9a-f]{24}$/i.test(userId) || !tenantId || tenantId.length > 80) return null;
  const userObjectId = new ObjectId(userId);
  const [user, membership, tenant] = await Promise.all([
    (await col.users()).findOne({ _id: userObjectId }),
    (await col.memberships()).findOne({ userId: userObjectId, tenantId }),
    (await col.tenants()).findOne({ _id: tenantId, status: "active" }),
  ]);
  if (!user || !(user.emailVerifiedAt || user.legacyBootstrap) || !membership || !tenant) return null;
  return accountPrincipal(user, membership, tenant);
}

function slugBase(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "workspace";
}

function tenantSlug(name: string): string {
  return `${slugBase(name)}-${randomBytes(3).toString("hex")}`;
}

export async function createPendingSignup(input: { email: string; password: string; tenantName: string; token: string }): Promise<{ ok: true; id: ObjectId } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (email === AXION_OWNER_EMAIL) return { ok: false, error: "This address is reserved for the existing Axion owner." };
  const users = await col.users();
  if (await users.findOne({ email }, { projection: { _id: 1 } })) return { ok: false, error: "An account already uses this address." };
  const id = new ObjectId();
  const tenantId = new ObjectId().toHexString();
  const now = new Date();
  const pending: PendingSignupDoc = {
    _id: id,
    userId: new ObjectId(),
    tenantId,
    tenantName: input.tenantName.trim().slice(0, 100),
    tenantSlug: tenantSlug(input.tenantName),
    email,
    passwordHash: await hashPassword(input.password),
    tokenHash: createHash("sha256").update(input.token).digest("hex"),
    createdAt: now,
    expiresAt: new Date(now.getTime() + SIGNUP_TTL_MS),
  };
  await (await col.signups()).insertOne(pending);
  return { ok: true, id };
}

export async function removePendingSignup(id: ObjectId): Promise<void> {
  await (await col.signups()).deleteOne({ _id: id });
}

export async function completeSignup(token: string): Promise<{ ok: true; principal: AccountPrincipal } | { ok: false; error: string }> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const signups = await col.signups();
  const pending = await signups.findOne({ tokenHash, expiresAt: { $gt: new Date() }, consumedAt: { $exists: false } });
  if (!pending) return { ok: false, error: "That verification link is invalid or has expired. Start signup again." };

  const users = await col.users();
  let user = await users.findOne({ _id: pending.userId });
  if (!user) {
    try {
      user = {
        _id: pending.userId,
        email: pending.email,
        passwordHash: pending.passwordHash,
        emailVerifiedAt: new Date(),
        createdAt: pending.createdAt,
        updatedAt: new Date(),
      };
      await users.insertOne(user);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        return { ok: false, error: "This address already has an account. Sign in instead." };
      }
      throw error;
    }
  }
  if (user.email !== pending.email || user.passwordHash !== pending.passwordHash) {
    return { ok: false, error: "This verification could not be completed. Start signup again." };
  }

  const tenants = await col.tenants();
  let tenant = await tenants.findOne({ _id: pending.tenantId });
  if (!tenant) {
    tenant = {
      _id: pending.tenantId,
      name: pending.tenantName,
      slug: pending.tenantSlug,
      status: "active",
      createdAt: pending.createdAt,
      updatedAt: new Date(),
    };
    try {
      await tenants.insertOne(tenant);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      tenant = await tenants.findOne({ _id: pending.tenantId });
      if (!tenant) throw error;
    }
  }
  const memberships = await col.memberships();
  let membership = await memberships.findOne({ tenantId: pending.tenantId, userId: pending.userId });
  if (!membership) {
    membership = { _id: new ObjectId(), tenantId: pending.tenantId, userId: pending.userId, role: "owner", createdAt: new Date() };
    try {
      await memberships.insertOne(membership);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      membership = await memberships.findOne({ tenantId: pending.tenantId, userId: pending.userId });
      if (!membership) throw error;
    }
  }
  // Claim the verification only after the idempotent account graph exists. If
  // two requests race, only one may activate a session; a failed request can
  // still retry safely before this compare-and-set succeeds.
  const consumed = await signups.updateOne(
    { _id: pending._id, tokenHash, consumedAt: { $exists: false } },
    { $set: { consumedAt: new Date() } },
  );
  if (consumed.modifiedCount !== 1) return { ok: false, error: "That verification link is invalid or has expired. Start signup again." };
  return { ok: true, principal: accountPrincipal(user, membership, tenant) };
}

/**
 * First login for the configured pre-account host. The configured email alias or the confirmed
 * Axion owner identity plus the configured password are required; the stored account always uses
 * the confirmed identity, and all later logins use its scrypt hash.
 */
export async function bootstrapLegacyAxionOwner(emailInput: string, password: string): Promise<AccountPrincipal | null> {
  const email = normalizeEmail(emailInput);
  if (password.length > 200) return null;
  const cfg = adminConfig();
  if ("error" in cfg || (email !== AXION_OWNER_EMAIL && email !== normalizeEmail(cfg.email)) || !safeEqual(Buffer.from(password), Buffer.from(cfg.password))) return null;

  const tenant: TenantDoc = {
    _id: AXION_TENANT_ID,
    name: "Axion",
    slug: "axion",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const tenants = await col.tenants();
  try {
    await tenants.updateOne({ _id: AXION_TENANT_ID }, { $setOnInsert: tenant }, { upsert: true });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
  }
  const axion = await tenants.findOne({ _id: AXION_TENANT_ID, status: "active" });
  if (!axion) return null;
  const memberships = await col.memberships();
  // Bootstrap is for first account creation and partial-graph recovery. Once an
  // Axion membership exists, do not recreate the reserved legacy email after an
  // owner changes it or otherwise reinitialize the workspace identity.
  if (await memberships.findOne({ tenantId: AXION_TENANT_ID })) return null;
  // Store the identity the owner confirmed even if the pre-account host login
  // used a different configured email address.
  const users = await col.users();
  let user = await users.findOne({ email: AXION_OWNER_EMAIL });
  if (user) {
    // A prior attempt may have inserted the account but failed to save its
    // membership. Repair that partial graph only while the bootstrap password
    // still matches the stored account; never restore access after a password change.
    if (!user.legacyBootstrap || !(await verifyPassword(password, user.passwordHash))) return null;
  } else {
    const now = new Date();
    const candidate: UserDoc = {
      _id: new ObjectId(),
      email: AXION_OWNER_EMAIL,
      passwordHash: await hashPassword(password),
      legacyBootstrap: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await users.insertOne(candidate);
      user = candidate;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      // Another request may have inserted the same bootstrap account first.
      user = await users.findOne({ email: AXION_OWNER_EMAIL });
      if (!user || !user.legacyBootstrap || !(await verifyPassword(password, user.passwordHash))) return null;
    }
  }
  const candidate: MembershipDoc = { _id: new ObjectId(), tenantId: AXION_TENANT_ID, userId: user._id, role: "owner", createdAt: new Date() };
  let axionMembership = candidate;
  try {
    await memberships.insertOne(candidate);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const existingMembership = await memberships.findOne({ tenantId: AXION_TENANT_ID, userId: user._id });
    if (!existingMembership) throw error;
    axionMembership = existingMembership;
  }
  return accountPrincipal(user, axionMembership, axion);
}

/** Rename an active workspace. Callers must authorize the owner's current tenant first. */
export async function updateTenantName(tenantId: string, nameInput: string): Promise<boolean> {
  const name = nameInput.trim();
  if (!tenantId || tenantId.length > 80 || !name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return false;
  const result = await (await col.tenants()).updateOne(
    { _id: tenantId, status: "active" },
    { $set: { name, updatedAt: new Date() } },
  );
  return result.matchedCount === 1;
}

export async function changeAccountPassword(userId: string, currentPassword: string, nextPassword: string): Promise<number | null> {
  if (!/^[0-9a-f]{24}$/i.test(userId)) return null;
  if (nextPassword.length < 12 || nextPassword.length > 200) return null;
  const users = await col.users();
  const user = await users.findOne({ _id: new ObjectId(userId) });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) return null;
  const nextVersion = (user.authVersion ?? 0) + 1;
  const versionFilter = user.authVersion === undefined ? { authVersion: { $exists: false } } : { authVersion: user.authVersion };
  const result = await users.updateOne(
    { _id: user._id, passwordHash: user.passwordHash, ...versionFilter },
    { $set: { passwordHash: await hashPassword(nextPassword), updatedAt: new Date() }, $inc: { authVersion: 1 } },
  );
  if (result.matchedCount !== 1) return null;
  await (await col.passwordResets()).deleteMany({ userId: user._id }).catch(() => {});
  return nextVersion;
}

/** Create a one-time password reset link without indicating whether an address has an account. */
export async function createPendingPasswordReset(input: { email: string; token: string }): Promise<ObjectId | null> {
  const email = normalizeEmail(input.email);
  const user = await (await col.users()).findOne({ email, emailVerifiedAt: { $exists: true } });
  if (!user) return null;
  const resets = await col.passwordResets();
  await resets.deleteMany({ userId: user._id });
  const id = new ObjectId();
  const now = new Date();
  const pending: PendingPasswordResetDoc = {
    _id: id,
    userId: user._id,
    tokenHash: createHash("sha256").update(input.token).digest("hex"),
    authVersion: user.authVersion ?? null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
  };
  try {
    await resets.insertOne(pending);
  } catch (error) {
    // A concurrent request may have inserted a reset for this user first.
    // Keep the public response indistinguishable from an unknown address.
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return null;
    throw error;
  }
  return id;
}

export async function removePendingPasswordReset(id: ObjectId): Promise<void> {
  await (await col.passwordResets()).deleteOne({ _id: id });
}

/** Consume one reset link and expire prior sessions by incrementing the user's auth version. */
export type CompletePasswordResetResult = { ok: true; email: string } | { ok: false };

export async function completePasswordReset(token: string, nextPassword: string): Promise<CompletePasswordResetResult> {
  if (nextPassword.length < 12 || nextPassword.length > 200) return { ok: false };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const resets = await col.passwordResets();
  const pending = await resets.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!pending) return { ok: false };
  // Reset links issued before account-version binding was added are retired safely.
  if (pending.authVersion === undefined) {
    await resets.deleteOne({ _id: pending._id, tokenHash }).catch(() => {});
    return { ok: false };
  }
  const users = await col.users();
  const user = await users.findOne({ _id: pending.userId, emailVerifiedAt: { $exists: true } });
  if (!user) return { ok: false };
  const versionFilter = pending.authVersion === null
    ? { authVersion: { $exists: false } }
    : { authVersion: pending.authVersion };
  if ((user.authVersion ?? null) !== pending.authVersion) {
    await resets.deleteOne({ _id: pending._id, tokenHash }).catch(() => {});
    return { ok: false };
  }
  const passwordHash = await hashPassword(nextPassword);
  const result = await users.updateOne(
    { _id: user._id, emailVerifiedAt: { $exists: true }, passwordHash: user.passwordHash, ...versionFilter },
    { $set: { passwordHash, authVersion: (user.authVersion ?? 0) + 1, updatedAt: new Date() } },
  );
  if (result.matchedCount !== 1) {
    await resets.deleteOne({ _id: pending._id, tokenHash }).catch(() => {});
    return { ok: false };
  }
  // Keep the link retryable when the account write fails. If this cleanup fails after the
  // account write, the stored authVersion makes the token stale and unusable on the next attempt.
  await resets.deleteOne({ _id: pending._id, tokenHash }).catch(() => {});
  return { ok: true, email: user.email };
}

export async function createPendingEmailChange(input: { userId: string; currentPassword: string; email: string; token: string }): Promise<{ ok: true; id: ObjectId } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{24}$/i.test(input.userId)) return { ok: false, error: "Account could not be verified." };
  const userId = new ObjectId(input.userId);
  const users = await col.users();
  const user = await users.findOne({ _id: userId });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) return { ok: false, error: "The current password is incorrect." };
  const email = normalizeEmail(input.email);
  const existing = await users.findOne({ email }, { projection: { _id: 1 } });
  if (existing && !existing._id.equals(userId)) return { ok: false, error: "An account already uses that address." };
  if (user.email === email && user.emailVerifiedAt) return { ok: false, error: "That is already the verified address on this account." };

  const changes = await col.emailChanges();
  await changes.deleteMany({ userId });
  const id = new ObjectId();
  const now = new Date();
  const pending: PendingEmailChangeDoc = {
    _id: id,
    userId,
    email,
    tokenHash: createHash("sha256").update(input.token).digest("hex"),
    createdAt: now,
    expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS),
  };
  try {
    await changes.insertOne(pending);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return { ok: false, error: "An email verification is already pending. Wait a moment and try again." };
    throw error;
  }
  return { ok: true, id };
}

export async function removePendingEmailChange(id: ObjectId): Promise<void> {
  await (await col.emailChanges()).deleteOne({ _id: id });
}

export async function completeEmailChange(token: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const changes = await col.emailChanges();
  const pending = await changes.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!pending) return { ok: false, error: "That verification link is invalid or has expired. Request a new one." };
  const users = await col.users();
  const owner = await users.findOne({ _id: pending.userId });
  if (!owner) return { ok: false, error: "This account could not be verified." };
  const duplicate = await users.findOne({ email: pending.email }, { projection: { _id: 1 } });
  if (duplicate && !duplicate._id.equals(owner._id)) return { ok: false, error: "That address is already in use. Request a different one." };
  try {
    const updated = await users.updateOne(
      { _id: owner._id, email: owner.email },
      { $set: { email: pending.email, emailVerifiedAt: new Date(), updatedAt: new Date() }, $unset: { legacyBootstrap: "" } },
    );
    if (updated.matchedCount !== 1) return { ok: false, error: "This account changed while verifying the address. Request a new link." };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return { ok: false, error: "That address is already in use. Request a different one." };
    throw error;
  }
  // Update first, then consume. If the account write fails, the link remains
  // retryable; concurrent opens may update the same address, but only one can
  // consume the single-use token and report success.
  const claimed = await changes.deleteOne({ _id: pending._id, tokenHash, expiresAt: { $gt: new Date() } });
  if (claimed.deletedCount !== 1) return { ok: false, error: "That verification link is invalid or has expired. Request a new one." };
  return { ok: true, email: pending.email };
}
