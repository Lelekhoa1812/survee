import { getPublicImageAsset } from "@/lib/repo/assets";

export async function GET(_req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  const asset = await getPublicImageAsset(publicId);
  if (!asset) return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  return new Response(new Uint8Array(asset.data), {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.data.byteLength),
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-site",
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
