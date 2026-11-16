import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { deleteImageAsset, renameImageAsset } from "@/lib/repo/assets";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ name?: unknown }>(req, 8 * 1024);
  if (!body.ok) return body.res;
  const name = str(body.data.name, 120);
  if (!name) return fail(400, "Give the image a name.");
  const asset = await renameImageAsset(id, name);
  return asset ? json({ ok: true, asset }) : fail(404, "Image not found.");
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ confirmName?: unknown }>(req, 8 * 1024);
  if (!body.ok) return body.res;
  const confirmName = str(body.data.confirmName, 120);
  if (!confirmName) return fail(400, "Confirm the image name before deleting it.");
  const result = await deleteImageAsset(id, confirmName);
  if (!result.ok && result.reason === "not_found") return fail(404, "Image not found.");
  if (!result.ok && result.reason === "confirmation_mismatch") return fail(400, "The image name did not match. Refresh the library and try again.");
  if (!result.ok && result.reason === "in_use") return fail(409, "This image is used by a saved questionnaire or active preview. Remove it there before deleting the image.");
  return json({ ok: true });
}
