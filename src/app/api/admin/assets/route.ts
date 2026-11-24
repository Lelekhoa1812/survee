import { createHash } from "node:crypto";
import { fail, guardAdmin, json, str, adminSession, withServerErrors } from "@/lib/http";
import { addImageAssetWithOperation, getImageUploadOperation, ImageAssetQuotaError, listImageAssets, MAX_IMAGE_BYTES } from "@/lib/repo/assets";
import { operationArgumentDigest, requestOperationId } from "@/lib/operation-id";

export const GET = withServerErrors("admin/assets", async function GET(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const url = new URL(req.url);
  const limitValue = Number(url.searchParams.get("limit") ?? "30");
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return fail(400, "limit must be from 1 to 100.");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (cursor && !/^[0-9a-f]{24}$/i.test(cursor)) return fail(400, "That image page cursor is not valid.");
  const page = await listImageAssets({ cursor, limit: limitValue });
  return json({ ok: true, ...page });
});

export const POST = withServerErrors("admin/assets", async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const operationId = requestOperationId(req);
  if (!operationId) return fail(400, "Send a valid Idempotency-Key header so an uncertain retry cannot create a duplicate image.", { code: "idempotency_key_required" });
  const maxBodyBytes = MAX_IMAGE_BYTES + 64 * 1024;
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > maxBodyBytes) return fail(413, `Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        return fail(413, `Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`);
      }
      chunks.push(value);
    }
  }
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const form = await new Request(req.url, { method: "POST", headers, body: Buffer.concat(chunks) }).formData().catch(() => null);
  if (!form) return fail(400, "Send an image file as multipart form data.");
  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file) || !("name" in file)) return fail(400, "Choose an image file.");
  const upload = file as File;
  if (upload.size > MAX_IMAGE_BYTES) return fail(413, `Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`);
  const name = str(form.get("name"), 120);
  try {
    const data = Buffer.from(await upload.arrayBuffer());
    const operation = {
      operationId,
      credentialId: `host:${session.userId}`,
      tool: "host_upload_image_asset",
      argumentDigest: operationArgumentDigest({ name, fileName: upload.name, dataSha256: createHash("sha256").update(data).digest("hex") }),
    };
    const previous = await getImageUploadOperation(operation);
    if (previous?.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different image content or details.", { code: "idempotency_key_conflict" });
    if (previous?.kind === "replayed") return json({ ok: true, asset: previous.asset }, 201);
    const result = await addImageAssetWithOperation({ name, fileName: upload.name, data }, operation);
    if (result.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different image content or details.", { code: "idempotency_key_conflict" });
    const asset = result.asset;
    return json({ ok: true, asset }, 201);
  } catch (error) {
    if (error instanceof ImageAssetQuotaError) return fail(413, error.message, { code: "workspace_image_quota_exceeded", usedBytes: error.usedBytes, requestedBytes: error.requestedBytes, quotaBytes: error.quotaBytes });
    const message = error instanceof Error && error.message.startsWith("Use a valid ") ? error.message
      : error instanceof Error && error.message.startsWith("Each image ") ? error.message
        : "The image could not be saved.";
    return fail(message.startsWith("Each image ") ? 413 : 400, message);
  }
});
