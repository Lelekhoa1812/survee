import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addImageAsset: vi.fn(),
  addImageAssetWithOperation: vi.fn(),
  getImageUploadOperation: vi.fn(),
  deleteImageAsset: vi.fn(),
  listImageAssets: vi.fn(),
  renameImageAsset: vi.fn(),
  inspectImage: vi.fn(),
  noteMcp: vi.fn(async () => {}),
  ImageAssetQuotaError: class ImageAssetQuotaError extends Error { usedBytes = 10; },
  InterviewPageCursorError: class InterviewPageCursorError extends Error {},
  InterviewPageFilterError: class InterviewPageFilterError extends Error {},
  MAX_INTERVIEW_SEARCH_LENGTH: 80,
}));

vi.mock("../src/lib/repo/assets", () => ({
  addImageAsset: mocks.addImageAsset,
  addImageAssetWithOperation: mocks.addImageAssetWithOperation,
  getImageUploadOperation: mocks.getImageUploadOperation,
  deleteImageAsset: mocks.deleteImageAsset,
  listImageAssets: mocks.listImageAssets,
  renameImageAsset: mocks.renameImageAsset,
  inspectImage: mocks.inspectImage,
  ImageAssetQuotaError: mocks.ImageAssetQuotaError,
  WORKSPACE_IMAGE_QUOTA_BYTES: 100,
}));
vi.mock("../src/lib/repo", () => ({
  noteMcp: mocks.noteMcp,
  InterviewPageCursorError: mocks.InterviewPageCursorError,
  InterviewPageFilterError: mocks.InterviewPageFilterError,
  MAX_INTERVIEW_SEARCH_LENGTH: mocks.MAX_INTERVIEW_SEARCH_LENGTH,
}));

import { dispatchTool, listToolDefs } from "../src/lib/mcp/tools";
import type { McpCapability } from "../src/lib/mcp/capabilities";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const asset = {
  id: "0123456789abcdef01234567", name: "Logo", fileName: "logo.png", mimeType: "image/png", bytes: png.length,
  sha256: "a".repeat(64), url: `/api/assets/${"z".repeat(43)}`, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspectImage.mockReturnValue({ ok: true, mimeType: "image/png" });
  mocks.addImageAsset.mockImplementation(async (input: { name: string }) => ({ ...asset, name: input.name }));
  mocks.addImageAssetWithOperation.mockImplementation(async (input: { name: string }) => ({ kind: "created", asset: { ...asset, name: input.name } }));
  mocks.getImageUploadOperation.mockResolvedValue(null);
  mocks.listImageAssets.mockResolvedValue({ assets: [asset], nextCursor: null });
  mocks.renameImageAsset.mockResolvedValue(asset);
  mocks.deleteImageAsset.mockResolvedValue({ ok: true });
});

describe("MCP image asset tools", () => {
  it("separates image library reads from image mutations", () => {
    const assetTools = ["list_image_assets", "upload_image_asset", "update_image_asset", "delete_image_asset"];
    expect(listToolDefs(["assets:read"] as McpCapability[]).map((tool) => tool.name)).toContain("list_image_assets");
    expect(listToolDefs(["assets:read"] as McpCapability[]).map((tool) => tool.name)).not.toEqual(expect.arrayContaining(assetTools.slice(1)));
    expect(listToolDefs(["assets:manage"] as McpCapability[]).map((tool) => tool.name)).toEqual(expect.arrayContaining(assetTools.slice(1)));
    expect(listToolDefs(["assets:read", "assets:manage"] as McpCapability[]).map((tool) => tool.name)).toEqual(expect.arrayContaining(assetTools));
    expect(listToolDefs(["interviews:read"] as McpCapability[]).map((tool) => tool.name)).not.toEqual(expect.arrayContaining(assetTools));
  });

  it("accepts base64 image bytes and returns a directly usable questionnaire snippet", async () => {
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token", auditActor: { kind: "service_token", id: "axion-service-token", name: "test" } }, () => dispatchTool("upload_image_asset", { fileName: "logo.png", name: "Logo & mark", dataBase64: `data:image/png;base64,${png.toString("base64")}`, operationId: "asset-first" }));
    expect(result.isError).toBe(false);
    expect(mocks.addImageAssetWithOperation).toHaveBeenCalledWith(expect.objectContaining({ fileName: "logo.png", name: "Logo & mark", data: png }), expect.objectContaining({ operationId: "asset-first" }));
    expect(result.structuredContent).toMatchObject({ asset: { ...asset, name: "Logo & mark" }, htmlExample: `<img src="${asset.url}" alt="Logo &amp; mark">` });
  });

  it("requires an operation ID before an image upload can write", async () => {
    const result = await dispatchTool("upload_image_asset", { fileName: "logo.png", dataBase64: png.toString("base64") });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "invalid_args" } });
    expect(mocks.addImageAsset).not.toHaveBeenCalled();
    expect(mocks.addImageAssetWithOperation).not.toHaveBeenCalled();
  });

  it("accepts upload operation IDs and replays the original asset without another write", async () => {
    const first = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token", auditActor: { kind: "service_token", id: "axion-service-token", name: "test" } }, () => dispatchTool("upload_image_asset", { fileName: "logo.png", name: "Logo", dataBase64: png.toString("base64"), operationId: "upload-1" }));
    expect(first.isError).toBe(false);
    expect(mocks.addImageAssetWithOperation).toHaveBeenCalledWith(expect.objectContaining({ fileName: "logo.png", name: "Logo", data: png }), expect.objectContaining({ operationId: "upload-1", credentialId: "service_token:axion-service-token", argumentDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    mocks.getImageUploadOperation.mockResolvedValueOnce({ kind: "replayed", asset });
    const replay = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token", auditActor: { kind: "service_token", id: "axion-service-token", name: "test" } }, () => dispatchTool("upload_image_asset", { fileName: "logo.png", name: "Logo", dataBase64: png.toString("base64"), operationId: "upload-1" }));
    expect(replay.structuredContent).toMatchObject({ asset, htmlExample: "<img src=\"" + asset.url + "\" alt=\"Logo\">" });
    expect(mocks.addImageAssetWithOperation).toHaveBeenCalledOnce();
  });

  it("rejects malformed image data before writing an asset", async () => {
    const result = await dispatchTool("upload_image_asset", { fileName: "logo.png", dataBase64: "%%%", operationId: "asset-invalid" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "dataBase64 must be valid base64 image data within the 2 MB size limit." });
    expect(mocks.addImageAsset).not.toHaveBeenCalled();
  });

  it("reports workspace image quota exhaustion as a typed tool error", async () => {
    mocks.addImageAssetWithOperation.mockRejectedValueOnce(Object.assign(new mocks.ImageAssetQuotaError("limit"), { usedBytes: 99 }));
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token", auditActor: { kind: "service_token", id: "axion-service-token", name: "test" } }, () => dispatchTool("upload_image_asset", { fileName: "logo.png", dataBase64: png.toString("base64"), operationId: "asset-quota" }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "workspace_image_quota_exceeded" });
  });

  it("pages library reads and requires exact-name delete confirmation", async () => {
    await expect(dispatchTool("list_image_assets", { limit: 1 })).resolves.toMatchObject({ structuredContent: { assets: [asset], nextCursor: null } });
    mocks.deleteImageAsset.mockResolvedValueOnce({ ok: false, reason: "in_use" });
    const result = await dispatchTool("delete_image_asset", { assetId: asset.id, confirmName: asset.name });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "asset_in_use" });
  });
});
