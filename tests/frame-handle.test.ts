import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRespondentFrameHandle, resolveRespondentFrameHandle } from "../src/lib/frame-handle";

describe("respondent frame handles", () => {
  it("keeps the respondent bearer out of the iframe URL and grants only expiring frame access", () => {
    process.env.SESSION_SECRET = "frame-handle-test-secret-at-least-16-chars";
    const token = "A".repeat(24);
    const now = Date.UTC(2026, 10, 24);
    const handle = createRespondentFrameHandle(token, now);

    expect(handle).not.toContain(token);
    expect(resolveRespondentFrameHandle(handle, now)).toBe(token);
    expect(resolveRespondentFrameHandle(handle, now + 60 * 60 * 1000)).toBeNull();
    expect(resolveRespondentFrameHandle(`${handle.slice(0, -1)}x`, now)).toBeNull();
  });

  it("cannot be resolved after the encryption secret changes", () => {
    const token = "B".repeat(24);
    process.env.SESSION_SECRET = "first-frame-secret-at-least-16-chars";
    const handle = createRespondentFrameHandle(token);
    process.env.SESSION_SECRET = "second-frame-secret-at-least-16-chars";

    expect(resolveRespondentFrameHandle(handle)).toBeNull();
  });
});
