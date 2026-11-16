import { fail, guardAdmin, json, str } from "@/lib/http";
import { addImageAsset, listImageAssets, MAX_IMAGE_BYTES } from "@/lib/repo/assets";

export async function GET(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const url = new URL(req.url);
  const limitValue = Number(url.searchParams.get("limit") ?? "30");
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return fail(400, "limit must be from 1 to 100.");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (cursor && !/^[0-9a-f]{24}$/i.test(cursor)) return fail(400, "That image page cursor is not valid.");
  const page = await listImageAssets({ cursor, limit: limitValue });
  return json({ ok: true, ...page });
}

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
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
    const asset = await addImageAsset({ name, fileName: upload.name, data: Buffer.from(await upload.arrayBuffer()) });
    return json({ ok: true, asset }, 201);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Use a valid ") ? error.message
      : error instanceof Error && error.message.startsWith("Each image ") ? error.message
        : "The image could not be saved.";
    return fail(message.startsWith("Each image ") ? 413 : 400, message);
  }
}
