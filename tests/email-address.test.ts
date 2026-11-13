import { describe, expect, it } from "vitest";
import { parseEmail, parsePersonLine } from "../src/lib/mail/address";
import { currentMail } from "../src/lib/mail/state";

describe("email address", () => {
  it("treats empty as valid and keeps a parsed address, not the raw paste", () => {
    expect(parseEmail("")).toEqual({ ok: true, email: null });
    expect(parseEmail("   ")).toEqual({ ok: true, email: null });
    expect(parseEmail("Ada <Ada@Example.com>")).toEqual({ ok: true, email: "ada@example.com" });
    expect(parseEmail("ada@example.com")).toEqual({ ok: true, email: "ada@example.com" });
  });

  it("rejects a malformed address", () => {
    expect(parseEmail("not an email").ok).toBe(false);
    expect(parseEmail("ada@").ok).toBe(false);
    expect(parseEmail("ada example.com").ok).toBe(false);
  });

  it("splits a pasted line into a name and a parsed address", () => {
    expect(parsePersonLine("Ada")).toEqual({ ok: true, person: { name: "Ada" } });
    expect(parsePersonLine("Ada, Ada@Example.com")).toEqual({ ok: true, person: { name: "Ada", email: "ada@example.com" } });
    expect(parsePersonLine("Ada <ada@example.com>")).toEqual({ ok: true, person: { name: "Ada", email: "ada@example.com" } });
    const bad = parsePersonLine("Ada, not-an-email@");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.emailRaw).toBe("not-an-email@");
  });
});

describe("sent state", () => {
  const sent = { id: "1", to: "ada@example.com", token: "token-a", status: "sent" as const, sentAt: "2026-11-13T00:00:00.000Z", messageId: "<m@example.com>" };

  it("is sent only for the same address and the same token", () => {
    expect(currentMail({ email: "ada@example.com", token: "token-a" }, [sent]).state).toBe("sent");
    expect(currentMail({ email: "ada@example.com", token: "token-b" }, [sent]).state).toBe("unsent");
    expect(currentMail({ email: "other@example.com", token: "token-a" }, [sent]).state).toBe("unsent");
    expect(currentMail({ email: null, token: "token-a" }, [sent]).state).toBe("unsent");
  });
});
