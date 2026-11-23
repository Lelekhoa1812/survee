import { guardAdmin, json, withServerErrors } from "@/lib/http";
import { getImageAssetUsage } from "@/lib/repo/assets";

export const GET = withServerErrors("admin/assets/usage", async function GET(_req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  return json({ ok: true, usage: await getImageAssetUsage() });
});
