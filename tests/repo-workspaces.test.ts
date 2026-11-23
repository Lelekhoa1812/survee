import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  users: [] as any[],
  tenants: [] as any[],
  memberships: [] as any[],
  invitations: [] as any[],
  events: [] as any[],
  failInvitationClaim: false,
}));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (filter: any) => store.users.find((item) => matches(item, filter)) ?? null,
      find: (filter: any) => cursor(store.users.filter((item) => matches(item, filter))),
      insertOne: async (doc: any) => {
        if (store.users.some((item) => item.email === doc.email)) throw Object.assign(new Error("duplicate"), { code: 11000 });
        store.users.push(doc);
        return { insertedId: doc._id };
      },
      updateOne: async (filter: any, update: any) => updateOne(store.users, filter, update),
    }),
    tenants: async () => ({
      findOne: async (filter: any) => store.tenants.find((item) => matches(item, filter)) ?? null,
      find: (filter: any) => cursor(store.tenants.filter((item) => matches(item, filter))),
      updateOne: async (filter: any, update: any) => updateOne(store.tenants, filter, update),
    }),
    memberships: async () => ({
      findOne: async (filter: any) => store.memberships.find((item) => matches(item, filter)) ?? null,
      find: (filter: any) => cursor(store.memberships.filter((item) => matches(item, filter))),
      insertOne: async (doc: any) => {
        if (store.memberships.some((item) => item.tenantId === doc.tenantId && same(item.userId, doc.userId))) throw Object.assign(new Error("duplicate"), { code: 11000 });
        store.memberships.push(doc);
        return { insertedId: doc._id };
      },
      updateOne: async (filter: any, update: any) => updateOne(store.memberships, filter, update),
      deleteOne: async (filter: any) => {
        const index = store.memberships.findIndex((item) => matches(item, filter));
        if (index < 0) return { deletedCount: 0 };
        store.memberships.splice(index, 1);
        return { deletedCount: 1 };
      },
    }),
    workspaceInvitations: async () => ({
      findOne: async (filter: any) => store.invitations.find((item) => matches(item, filter)) ?? null,
      find: (filter: any) => cursor(store.invitations.filter((item) => matches(item, filter))),
      updateOne: async (filter: any, update: any, options?: any) => {
        if (store.failInvitationClaim && filter.expiresAt?.$gt && filter.acceptedAt?.$exists === false) {
          store.failInvitationClaim = false;
          return { matchedCount: 0, modifiedCount: 0 };
        }
        let doc = store.invitations.find((item) => matches(item, filter));
        if (!doc && options?.upsert) {
          const equality = plainFilter(filter);
          if (store.invitations.some((item) => item.tenantId === equality.tenantId && item.email === equality.email)) {
            throw Object.assign(new Error("duplicate"), { code: 11000 });
          }
          doc = { _id: new ObjectId(), ...equality };
          store.invitations.push(doc);
        }
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(doc, update.$set ?? {});
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
    events: async () => ({ insertOne: async (doc: any) => { store.events.push(doc); return { insertedId: doc._id }; } }),
  },
  withMongoTransaction: async (work: (session: object) => Promise<unknown>) => {
    const snapshot = Object.fromEntries(["users", "tenants", "memberships", "invitations", "events"].map((key) => [key, (store as any)[key].map((doc: any) => ({ ...doc }))]));
    try {
      const result = await work({});
      if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
      return result;
    } catch (error) {
      for (const key of Object.keys(snapshot)) (store as any)[key].splice(0, (store as any)[key].length, ...(snapshot as any)[key]);
      throw error;
    }
  },
}));

vi.mock("../src/lib/repo/accounts", () => ({ hashPassword: async (password: string) => `test-hash:${password}` }));

function same(a: any, b: any): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matches(doc: any, filter: any): boolean {
  return Object.entries(filter ?? {}).every(([key, expected]: [string, any]) => {
    const actual = doc[key];
    if (key === "$or") return expected.some((branch: any) => matches(doc, branch));
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !(expected instanceof ObjectId)) {
      if ("$in" in expected) return expected.$in.some((value: any) => same(actual, value));
      if ("$exists" in expected) return (actual !== undefined) === expected.$exists;
      if ("$gt" in expected) return actual instanceof Date ? actual > expected.$gt : actual > expected.$gt;
      if ("$lte" in expected) return actual instanceof Date ? actual <= expected.$lte : actual <= expected.$lte;
      return matches(actual ?? {}, expected);
    }
    return same(actual, expected);
  });
}

function plainFilter(filter: any): any {
  return Object.fromEntries(Object.entries(filter).filter(([, value]: [string, any]) => !(value && typeof value === "object" && Object.keys(value).some((key) => key.startsWith("$")))));
}

function updateOne(rows: any[], filter: any, update: any) {
  const doc = rows.find((item) => matches(item, filter));
  if (!doc) return { matchedCount: 0, modifiedCount: 0 };
  Object.assign(doc, update.$set ?? {});
  for (const [key, value] of Object.entries(update.$inc ?? {})) doc[key] = (doc[key] ?? 0) + Number(value);
  for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
  return { matchedCount: 1, modifiedCount: 1 };
}

function cursor(rows: any[]) {
  return {
    values: rows,
    sort(order: Record<string, 1 | -1>) {
      const entries = Object.entries(order);
      this.values.sort((a, b) => {
        for (const [key, direction] of entries) {
          const av = a[key] instanceof Date ? a[key].getTime() : a[key];
          const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
          if (av < bv) return -1 * direction;
          if (av > bv) return direction;
        }
        return 0;
      });
      return this;
    },
    toArray: async () => rows,
  };
}

import {
  acceptWorkspaceInvitation,
  changeWorkspaceMemberRole,
  createInvitedAccount,
  createWorkspaceInvitation,
  getWorkspaceInvitation,
  listAccountWorkspaces,
  listWorkspaceAccess,
  rememberWorkspace,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  revokeWorkspaceInvitationByToken,
  transferWorkspaceOwnership,
  updateWorkspaceInvitationMail,
} from "../src/lib/repo/workspaces";

const ownerId = new ObjectId("000000000000000000000001");
const inviteeId = new ObjectId("000000000000000000000002");
const invitationTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function addTenant(id: string, name: string, status: "active" | "suspended" = "active") {
  store.tenants.push({ _id: id, name, status });
}

function addMembership(tenantId: string, userId: ObjectId, role: string, createdAt = new Date()) {
  store.memberships.push({ _id: new ObjectId(), tenantId, userId, role, createdAt });
}

beforeEach(() => {
  store.users.splice(0);
  store.tenants.splice(0);
  store.memberships.splice(0);
  store.invitations.splice(0);
  store.events.splice(0);
  store.failInvitationClaim = false;
  addTenant("axion", "Axion");
  addTenant("workspace-b", "Workspace B");
  addTenant("workspace-suspended", "Suspended", "suspended");
  store.users.push(
    { _id: ownerId, email: "owner@example.test", emailVerifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    { _id: inviteeId, email: "member@example.test", emailVerifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
  );
  addMembership("axion", ownerId, "owner", new Date("2026-01-01T00:00:00Z"));
});

describe("workspace membership and invitations", () => {
  it("does not let a superseded mail attempt update a replacement invitation", async () => {
    const id = new ObjectId();
    const currentMessageId = "<replacement-message@example.test>";
    store.invitations.push({ _id: id, tenantId: "axion", email: "person@example.test", messageId: currentMessageId, mailStatus: "pending" });

    await expect(updateWorkspaceInvitationMail("axion", id.toHexString(), "<old-message@example.test>", { mailStatus: "sent" })).resolves.toBe(false);
    expect(store.invitations[0]).toMatchObject({ messageId: currentMessageId, mailStatus: "pending" });
    expect(store.invitations[0].delivery).toBeUndefined();
  });

  it("lists only active workspaces for the account and remembers only an actual membership", async () => {
    addMembership("workspace-b", ownerId, "admin", new Date("2026-02-01T00:00:00Z"));
    addMembership("workspace-suspended", ownerId, "member", new Date("2026-03-01T00:00:00Z"));

    await expect(listAccountWorkspaces(ownerId.toHexString())).resolves.toEqual([
      { tenantId: "axion", name: "Axion", role: "owner" },
      { tenantId: "workspace-b", name: "Workspace B", role: "admin" },
    ]);
    await expect(listAccountWorkspaces("not-an-object-id")).resolves.toEqual([]);
    await expect(rememberWorkspace(ownerId.toHexString(), "workspace-b")).resolves.toBe(true);
    await expect(rememberWorkspace(ownerId.toHexString(), "not-a-member")).resolves.toBe(false);
    expect(store.users[0].lastTenantId).toBe("workspace-b");
  });

  it("stores only a token hash and refuses to rotate an active invitation", async () => {
    const first = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: " New.Person@Example.test ", role: "member" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.token).toMatch(invitationTokenPattern);
    expect(store.invitations[0]).toMatchObject({
      tenantId: "axion", email: "new.person@example.test", role: "member",
      tokenHash: createHash("sha256").update(first.token).digest("hex"),
    });
    expect(store.invitations[0]).not.toHaveProperty("token");
    await expect(getWorkspaceInvitation(first.token)).resolves.toMatchObject({ tenantId: "axion", tenantName: "Axion", email: "new.person@example.test" });

    const second = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "new.person@example.test", role: "admin" });
    expect(second).toEqual({ ok: false, reason: "pending" });
    expect(store.invitations).toHaveLength(1);
    expect(store.invitations[0].role).toBe("member");
    expect(store.invitations[0].tokenHash).toBe(createHash("sha256").update(first.token).digest("hex"));
    await expect(getWorkspaceInvitation(first.token)).resolves.toMatchObject({ tenantId: "axion" });
    const access = await listWorkspaceAccess("axion");
    expect(access).toMatchObject({
      ownerCount: 1,
      members: [{ userId: ownerId.toHexString(), email: "owner@example.test", role: "owner", createdAt: expect.any(String) }],
    });
    expect(access.invitations).toMatchObject([{ email: "new.person@example.test", role: "member" }]);
  });

  it("rolls back a membership when the invitation expires before its claim", async () => {
    const created = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "member@example.test", role: "member" });
    if (!created.ok) throw new Error("Expected invitation creation to succeed.");
    store.failInvitationClaim = true;

    await expect(acceptWorkspaceInvitation(created.token, inviteeId.toHexString(), "member@example.test"))
      .resolves.toEqual({ ok: false, reason: "invalid" });
    expect(store.memberships.some((item) => item.tenantId === "axion" && item.userId.equals(inviteeId))).toBe(false);
    expect(store.invitations[0].acceptedAt).toBeUndefined();
  });

  it("rolls back an invited account when the invitation expires before its claim", async () => {
    const created = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "new-account@example.test", role: "member" });
    if (!created.ok) throw new Error("Expected invitation creation to succeed.");
    store.failInvitationClaim = true;

    await expect(createInvitedAccount(created.token, "a sufficiently long password"))
      .resolves.toEqual({ ok: false, reason: "invalid" });
    expect(store.users.some((item) => item.email === "new-account@example.test")).toBe(false);
    expect(store.memberships.some((item) => item.tenantId === "axion" && item.userId !== ownerId)).toBe(false);
    expect(store.invitations[0].acceptedAt).toBeUndefined();
  });

  it("removes one tenant membership, preserves other workspaces, and writes a minimal audit event", async () => {
    addMembership("axion", inviteeId, "member");
    addMembership("workspace-b", inviteeId, "admin");

    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString() }))
      .resolves.toEqual({ ok: true, role: "member" });
    expect(store.memberships.some((item) => item.tenantId === "axion" && item.userId.equals(inviteeId))).toBe(false);
    expect(store.memberships.some((item) => item.tenantId === "workspace-b" && item.userId.equals(inviteeId))).toBe(true);
    expect(store.events).toMatchObject([{ tenantId: "axion", type: "workspace_member_removed", meta: {
      actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString(), role: "member",
    } }]);
    expect(JSON.stringify(store.events)).not.toContain("member@example.test");
  });

  it("lets admins remove other admins but not owners, and blocks members from managing access", async () => {
    const adminId = inviteeId;
    const secondAdminId = new ObjectId("000000000000000000000003");
    const memberId = new ObjectId("000000000000000000000004");
    store.users.push(
      { _id: secondAdminId, email: "second-admin@example.test", emailVerifiedAt: new Date() },
      { _id: memberId, email: "member@example.test", emailVerifiedAt: new Date() },
    );
    addMembership("axion", adminId, "admin");
    addMembership("axion", secondAdminId, "admin");
    addMembership("axion", memberId, "member");

    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: memberId.toHexString(), targetUserId: secondAdminId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: adminId.toHexString(), targetUserId: ownerId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: adminId.toHexString(), targetUserId: secondAdminId.toHexString() }))
      .resolves.toEqual({ ok: true, role: "admin" });
  });

  it("protects the last owner and treats cross-tenant member ids as not found", async () => {
    addMembership("workspace-b", inviteeId, "admin");

    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: ownerId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "last_owner" });
    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect(store.memberships.some((item) => item.tenantId === "axion" && item.userId.equals(ownerId))).toBe(true);
    expect(store.events).toHaveLength(0);
  });

  it("allows an owner to remove a co-owner without deleting the last owner", async () => {
    addMembership("axion", inviteeId, "owner");

    await expect(removeWorkspaceMember({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString() }))
      .resolves.toEqual({ ok: true, role: "owner" });
    expect(store.tenants[0].membershipEpoch).toBe(1);
    expect(store.memberships.filter((item) => item.tenantId === "axion" && item.role === "owner")).toHaveLength(1);
  });

  it("transfers ownership transactionally and keeps the former owner as an admin", async () => {
    addMembership("axion", inviteeId, "member");

    await expect(transferWorkspaceOwnership({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString() }))
      .resolves.toEqual({ ok: true, previousOwnerUserId: ownerId.toHexString(), newOwnerUserId: inviteeId.toHexString() });
    expect(store.memberships.find((item) => item.tenantId === "axion" && item.userId.equals(ownerId))?.role).toBe("admin");
    expect(store.memberships.find((item) => item.tenantId === "axion" && item.userId.equals(inviteeId))?.role).toBe("owner");
    expect(store.memberships.filter((item) => item.tenantId === "axion" && item.role === "owner")).toHaveLength(1);
    expect(store.tenants[0].membershipEpoch).toBe(1);
    expect(store.events).toMatchObject([{ type: "workspace_owner_transferred", meta: {
      previousOwnerUserId: ownerId.toHexString(), newOwnerUserId: inviteeId.toHexString(),
    } }]);
    expect(JSON.stringify(store.events)).not.toContain("member@example.test");
  });

  it("requires a distinct existing workspace member and an active owner", async () => {
    addMembership("axion", inviteeId, "admin");
    await expect(transferWorkspaceOwnership({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: ownerId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(transferWorkspaceOwnership({ tenantId: "axion", actorUserId: inviteeId.toHexString(), targetUserId: ownerId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(transferWorkspaceOwnership({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: new ObjectId("000000000000000000000003").toHexString() }))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(transferWorkspaceOwnership({ tenantId: "workspace-suspended", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString() }))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(store.events).toHaveLength(0);
  });

  it("lets an owner promote or demote a non-owner and audits each real change", async () => {
    addMembership("axion", inviteeId, "member");
    await expect(changeWorkspaceMemberRole({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString(), role: "admin" }))
      .resolves.toEqual({ ok: true, previousRole: "member", role: "admin" });
    await expect(changeWorkspaceMemberRole({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString(), role: "member" }))
      .resolves.toEqual({ ok: true, previousRole: "admin", role: "member" });
    expect(store.memberships.find((item) => item.tenantId === "axion" && item.userId.equals(inviteeId))?.role).toBe("member");
    expect(store.tenants[0].membershipEpoch).toBe(2);
    expect(store.events.map((event) => event.type)).toEqual(["workspace_member_role_changed", "workspace_member_role_changed"]);
    expect(store.events[0].meta).toMatchObject({ actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString(), previousRole: "member", role: "admin" });
  });

  it("keeps owner transfer separate from ordinary role changes", async () => {
    addMembership("axion", inviteeId, "owner");
    const adminId = new ObjectId("000000000000000000000003");
    addMembership("axion", adminId, "member");
    await expect(changeWorkspaceMemberRole({ tenantId: "axion", actorUserId: ownerId.toHexString(), targetUserId: inviteeId.toHexString(), role: "member" }))
      .resolves.toEqual({ ok: false, reason: "owner_transfer_required" });
    await expect(changeWorkspaceMemberRole({ tenantId: "axion", actorUserId: adminId.toHexString(), targetUserId: ownerId.toHexString(), role: "member" }))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(store.events).toHaveLength(0);
  });

  it("blocks non-admin inviters, duplicate members, revoked links, and cross-tenant revoke attempts", async () => {
    addMembership("axion", inviteeId, "member");
    await expect(createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: inviteeId.toHexString(), email: "new@example.test", role: "member" })).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "member@example.test", role: "member" })).resolves.toEqual({ ok: false, reason: "already_member" });
    const created = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "new@example.test", role: "member" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = store.invitations[0]._id.toHexString();
    await expect(revokeWorkspaceInvitation("workspace-b", id)).resolves.toBe(false);
    await expect(revokeWorkspaceInvitation("axion", id)).resolves.toBe(true);
    await expect(getWorkspaceInvitation(created.token)).resolves.toBeNull();
    await revokeWorkspaceInvitationByToken("axion", created.token);
  });

  it("requires the invited email, verified account, and active tenant, then accepts idempotently", async () => {
    const created = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "member@example.test", role: "admin" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(acceptWorkspaceInvitation(created.token, inviteeId.toHexString(), "other@example.test")).resolves.toEqual({ ok: false, reason: "email_mismatch" });
    expect(store.memberships).toHaveLength(1);

    await expect(acceptWorkspaceInvitation(created.token, inviteeId.toHexString(), "member@example.test")).resolves.toEqual({ ok: true, tenantId: "axion" });
    expect(store.memberships).toHaveLength(2);
    expect(store.memberships[1]).toMatchObject({ tenantId: "axion", role: "admin" });
    expect(store.users[1].lastTenantId).toBe("axion");
    await expect(acceptWorkspaceInvitation(created.token, inviteeId.toHexString(), "member@example.test")).resolves.toEqual({ ok: true, tenantId: "axion" });
    expect(store.memberships).toHaveLength(2);
  });

  it("creates a verified account from an invite and rejects an existing account collision", async () => {
    const created = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "brand-new@example.test", role: "member" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(createInvitedAccount(created.token, "short")).resolves.toEqual({ ok: false, reason: "invalid" });
    const result = await createInvitedAccount(created.token, "a sufficiently long password");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newUser = store.users.find((user) => user._id.toHexString() === result.userId);
    expect(newUser).toMatchObject({ email: "brand-new@example.test", passwordHash: "test-hash:a sufficiently long password", lastTenantId: "axion", emailVerifiedAt: expect.any(Date) });
    expect(store.memberships.at(-1)).toMatchObject({ tenantId: "axion", userId: newUser._id, role: "member" });
    expect(store.invitations[0].acceptedByUserId).toEqual(newUser._id);

    const collision = await createWorkspaceInvitation({ tenantId: "axion", invitedByUserId: ownerId.toHexString(), email: "member@example.test", role: "member" });
    expect(collision.ok).toBe(true);
    if (!collision.ok) return;
    await expect(createInvitedAccount(collision.token, "another sufficiently long password")).resolves.toEqual({ ok: false, reason: "account_exists" });
  });
});
