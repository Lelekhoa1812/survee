import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, any>>,
  revoked: [] as Array<Record<string, any>>,
}));

vi.mock("../src/lib/db", () => ({
  col: {
    userSessions: async () => ({
      updateOne: async (filter: Record<string, unknown>, update: { $setOnInsert?: Record<string, unknown> }) => {
        if (!state.sessions.some((row) => row.sid === filter.sid) && update.$setOnInsert) state.sessions.push(update.$setOnInsert);
        return { matchedCount: 1, upsertedCount: 1 };
      },
      findOne: async (filter: Record<string, any>) => state.sessions.find((row) => row.sid === filter.sid && row.userId.equals(filter.userId) && row.authVersion === filter.authVersion && row.expiresAt > filter.expiresAt.$gt) ?? null,
      find: (filter: Record<string, any>) => {
        const rows = state.sessions.filter((row) => row.userId.equals(filter.userId) && row.authVersion === filter.authVersion && row.expiresAt > filter.expiresAt.$gt);
        const cursor: any = {
          rows,
          sort() { this.rows.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()); return this; },
          limit(n: number) { this.rows = this.rows.slice(0, n); return this; },
          toArray: async () => cursor.rows,
        };
        return cursor;
      },
    }),
    revoked: async () => ({
      find: (filter: { sid: { $in: string[] } }) => ({ toArray: async () => state.revoked.filter((row) => filter.sid.$in.includes(row.sid)) }),
    }),
  },
}));

import { listUserSessions, registerUserSession } from "../src/lib/repo";

beforeEach(() => {
  state.sessions.length = 0;
  state.revoked.length = 0;
});

describe("user session inventory repository", () => {
  it("stores no address or user-agent and returns safe active-session metadata", async () => {
    const userId = "000000000000000000000001";
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await registerUserSession({ sid: "current", userId, tenantId: "workspace-a", authVersion: 2, exp });
    await registerUserSession({ sid: "other", userId, tenantId: "workspace-b", authVersion: 2, exp });
    state.revoked.push({ sid: "other" });
    const sessions = await listUserSessions({ userId, authVersion: 2, currentSid: "current" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ current: true, createdAt: expect.any(String), expiresAt: expect.any(String) });
    expect(Object.keys(state.sessions[0]).sort()).toEqual(["_id", "authVersion", "createdAt", "expiresAt", "sid", "tenantId", "userId"].sort());
  });

  it("does not list expired sessions or sessions from an older auth version", async () => {
    const userId = "000000000000000000000001";
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await registerUserSession({ sid: "current", userId, tenantId: "workspace-a", authVersion: 3, exp });
    state.sessions.push({ _id: new ObjectId(), sid: "old-version", userId: new ObjectId(userId), tenantId: "workspace-a", authVersion: 2, createdAt: new Date(), expiresAt: new Date(exp * 1000) });
    state.sessions.push({ _id: new ObjectId(), sid: "expired", userId: new ObjectId(userId), tenantId: "workspace-a", authVersion: 3, createdAt: new Date(), expiresAt: new Date(0) });
    expect(await listUserSessions({ userId, authVersion: 3, currentSid: "current" })).toHaveLength(1);
  });

  it("keeps the current session visible when it is older than the latest 50 sessions", async () => {
    const userId = new ObjectId("000000000000000000000001");
    const now = Date.now();
    state.sessions.push({ _id: new ObjectId(), sid: "current", userId, tenantId: "workspace-a", authVersion: 4, createdAt: new Date(now - 100_000), expiresAt: new Date(now + 60_000) });
    for (let i = 0; i < 55; i += 1) {
      state.sessions.push({ _id: new ObjectId(), sid: `recent-${i}`, userId, tenantId: "workspace-a", authVersion: 4, createdAt: new Date(now + i), expiresAt: new Date(now + 60_000) });
    }

    const sessions = await listUserSessions({ userId: userId.toHexString(), authVersion: 4, currentSid: "current" });
    expect(sessions).toHaveLength(50);
    expect(sessions[0]).toMatchObject({ current: true });
  });
});
