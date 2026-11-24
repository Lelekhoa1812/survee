import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/components/ui";

afterEach(() => vi.unstubAllGlobals());

describe("host API request helper", () => {
  it("passes multipart forms and idempotency headers without setting a multipart boundary", async () => {
    const response = Response.json({ ok: true, asset: { id: "asset-1" } }, { status: 201 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("name", "Logo");
    const result = await api("/api/admin/assets", { method: "POST", headers: { "Idempotency-Key": "upload-1" }, body: form });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/assets", expect.objectContaining({
      method: "POST", body: form, headers: { "Idempotency-Key": "upload-1" }, credentials: "same-origin",
    }));
  });

  it("continues encoding JSON bodies and preserving caller headers", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { people: [{ name: "Ada" }] };
    await api("/api/admin/interviews/i/people", { method: "POST", headers: { "Idempotency-Key": "people-1" }, body });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body: JSON.stringify(body), headers: { "Idempotency-Key": "people-1", "Content-Type": "application/json" },
    }));
  });
});
