import { describe, expect, it } from "vitest";
import { createSession, verifySession } from "../src/lib/auth";
import { hashPassword, verifyPassword } from "../src/lib/repo/accounts";

describe("account credentials", () => {
  it("stores a salted scrypt hash and verifies only the matching password", async () => {
    const first = await hashPassword("a suitably long password 123");
    const second = await hashPassword("a suitably long password 123");
    expect(first).not.toBe(second);
    expect(first).not.toContain("a suitably long password");
    await expect(verifyPassword("a suitably long password 123", first)).resolves.toBe(true);
    await expect(verifyPassword("different password", first)).resolves.toBe(false);
  });

  it("signs the active tenant and rejects legacy email-only sessions", () => {
    const issued = createSession({ userId: "000000000000000000000001", tenantId: "tenant-b", email: "owner@example.com", role: "owner", authVersion: 2 });
    expect(issued).not.toBeNull();
    if (!issued) return;
    expect(verifySession(issued.value)).toMatchObject({ userId: "000000000000000000000001", tenantId: "tenant-b", role: "owner", email: "owner@example.com", authVersion: 2 });
    expect(verifySession("legacy.session.value")).toBeNull();
  });
});
