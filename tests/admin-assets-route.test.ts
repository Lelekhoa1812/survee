import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  addImageAsset: vi.fn(),
  deleteImageAsset: vi.fn(),
  listImageAssets: vi.fn(),
  renameImageAsset: vi.fn(),
  getPublicImageAsset: vi.fn(),
  getImageAssetUsage: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  fail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
  json: (data: unknown, status = 200, extra?: Record<string, string>) => Response.json(data, { status, headers: extra }),
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  readJson: async (req: Request) => {
    try { return { ok: true, data: await req.json() }; }
    catch { return { ok: false, res: Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 }) }; }
  },
}));

vi.mock("@/lib/repo/assets", () => ({
  addImageAsset: state.addImageAsset,
  deleteImageAsset: state.deleteImageAsset,
  listImageAssets: state.listImageAssets,
  renameImageAsset: state.renameImageAsset,
  getPublicImageAsset: state.getPublicImageAsset,
  getImageAssetUsage: state.getImageAssetUsage,
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
}));

import { GET as listAssets, POST as uploadAsset } from "../src/app/api/admin/assets/route";
import { GET as getAssetUsage } from "../src/app/api/admin/assets/usage/route";
import { DELETE as deleteAsset, PATCH as renameAsset } from "../src/app/api/admin/assets/[id]/route";
import { GET as getPublicAsset } from "../src/app/api/assets/[publicId]/route";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const asset = {
  id: "0123456789abcdef01234567", name: "Logo", fileName: "logo.png", mimeType: "image/png", bytes: png.length,
  sha256: "a".repeat(64), url: `/api/assets/${"z".repeat(43)}`, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
  state.addImageAsset.mockResolvedValue(asset);
  state.listImageAssets.mockResolvedValue({ assets: [asset], nextCursor: null });
  state.renameImageAsset.mockResolvedValue(asset);
  state.deleteImageAsset.mockResolvedValue({ ok: true });
  state.getPublicImageAsset.mockResolvedValue({ mimeType: "image/png", data: png, fileName: "logo.png", sha256: asset.sha256 });
  state.getImageAssetUsage.mockResolvedValue({ assetCount: 3, totalBytes: 1536 });
});

function routeRequest(path: string, init?: RequestInit) {
  return new Request(`https://kqa.local${path}`, init);
}

describe("image asset routes", () => {
  it("requires a signed-in admin for library reads and writes", async () => {
    state.denied = Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
    expect((await listAssets(routeRequest("/api/admin/assets"))).status).toBe(401);
    expect((await uploadAsset(routeRequest("/api/admin/assets", { method: "POST" }))).status).toBe(401);
    expect(state.listImageAssets).not.toHaveBeenCalled();
    expect(state.addImageAsset).not.toHaveBeenCalled();
  });

  it("lists pages and validates cursors and limits", async () => {
    const response = await listAssets(routeRequest("/api/admin/assets?limit=1"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ assets: [asset], nextCursor: null });
    expect(state.listImageAssets).toHaveBeenCalledWith({ cursor: undefined, limit: 1 });
    expect((await listAssets(routeRequest("/api/admin/assets?limit=101"))).status).toBe(400);
    expect((await listAssets(routeRequest("/api/admin/assets?cursor=bad"))).status).toBe(400);
  });

  it("requires a signed-in workspace member for aggregate asset usage", async () => {
    const response = await getAssetUsage(routeRequest("/api/admin/assets/usage"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ usage: { assetCount: 3, totalBytes: 1536 } });

    state.denied = Response.json({ ok: false }, { status: 401 });
    expect((await getAssetUsage(routeRequest("/api/admin/assets/usage"))).status).toBe(401);
    expect(state.getImageAssetUsage).toHaveBeenCalledOnce();
  });

  it("stores valid multipart uploads and enforces the per-image request bound", async () => {
    const form = new FormData();
    form.set("file", new Blob([png], { type: "text/plain" }), "logo.png");
    form.set("name", "Logo");
    const response = await uploadAsset(routeRequest("/api/admin/assets", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    expect(state.addImageAsset).toHaveBeenCalledWith({ name: "Logo", fileName: "logo.png", data: png });

    const tooLarge = routeRequest("/api/admin/assets", { method: "POST", body: new Uint8Array(2 * 1024 * 1024 + 64 * 1024 + 1) });
    expect((await uploadAsset(tooLarge)).status).toBe(413);
    expect(state.addImageAsset).toHaveBeenCalledTimes(1);
  });

  it("renames assets and protects deletion with exact-name confirmation", async () => {
    const ctx = { params: Promise.resolve({ id: asset.id }) };
    const patch = await renameAsset(routeRequest(`/api/admin/assets/${asset.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "New logo" }) }), ctx);
    expect(patch.status).toBe(200);
    expect(state.renameImageAsset).toHaveBeenCalledWith(asset.id, "New logo");

    state.deleteImageAsset.mockResolvedValueOnce({ ok: false, reason: "in_use" });
    const deletion = await deleteAsset(routeRequest(`/api/admin/assets/${asset.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmName: "Logo" }) }), ctx);
    expect(deletion.status).toBe(409);
    expect(state.deleteImageAsset).toHaveBeenCalledWith(asset.id, "Logo");
  });

  it("serves stored bytes with a fixed detected MIME type and safe response headers", async () => {
    const response = await getPublicAsset(routeRequest(asset.url), { params: Promise.resolve({ publicId: "z".repeat(43) }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);

    state.getPublicImageAsset.mockResolvedValueOnce(null);
    expect((await getPublicAsset(routeRequest("/api/assets/missing"), { params: Promise.resolve({ publicId: "missing" }) })).status).toBe(404);
  });
});
