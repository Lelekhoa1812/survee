import { buildBundle, DOCS, readAsset, readDoc } from "@/lib/docs";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ name: string[] }> };

/** Public, read-only. Agents can fetch /api/docs/bundle.md directly. */
export async function GET(req: Request, { params }: Ctx) {
  const { name } = await params;
  const rel = name.join("/");
  const headers = { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" };

  if (rel === "bundle.md") {
    const origin = new URL(req.url).origin;
    return new NextResponse(await buildBundle(origin), { headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'inline; filename="kqa-format-bundle.md"' } });
  }
  const doc = DOCS.find((d) => d.file === rel || d.slug === rel.replace(/\.md$/, ""));
  if (doc) {
    const text = await readDoc(doc.file);
    if (text) return new NextResponse(text, { headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" } });
  }
  const asset = await readAsset(rel);
  if (asset) {
    const h: Record<string, string> = { ...headers, "Content-Type": asset.type };
    if (rel.endsWith(".html")) {
      h["Content-Disposition"] = `attachment; filename="${rel.split("/").pop()}"`;
      h["Content-Security-Policy"] = "sandbox; frame-ancestors 'none'";
    }
    return new NextResponse(asset.body, { headers: h });
  }
  return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
}
