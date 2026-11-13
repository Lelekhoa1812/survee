import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { CopyBundle } from "@/components/CopyBundle";
import { Icon } from "@/components/ui";
import { buildBundle, DOCS, readDoc } from "@/lib/docs";

export const metadata = { title: "Guide" };
export const dynamic = "force-dynamic";

function slugify(s: string) {
  return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const current = DOCS.find((d) => d.slug === (slug?.[0] ?? "format"));
  if (!current || (slug && slug.length > 1)) notFound();
  const text = (await readDoc(current.file)) ?? "This page has not been written yet.";
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const raw = tokens.map((t) => ("text" in t ? (t as { text: string }).text : "")).join("");
    const inner = renderer.parser.parseInline(tokens);
    return `<h${depth} id="${slugify(raw)}">${inner}</h${depth}>`;
  };
  // Raw HTML in the docs is shown as text, never run.
  renderer.html = ({ text: t }) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = await marked.parse(text, { renderer, gfm: true });
  const bundle = await buildBundle("this app");

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Guide</h1>
          <p>Everything needed to write a questionnaire file that KQA accepts. Give an AI agent the bundle and it can produce one that passes first time.</p>
        </div>
        <div className="right row wrap">
          <CopyBundle text={bundle} />
          <a className="btn sm" href="/api/docs/template/starter.kqa.html" download><Icon name="download" size={15} /> Starter template</a>
          <a className="btn sm" href="/api/docs/kqa-manifest.schema.json" target="_blank" rel="noreferrer">JSON Schema</a>
        </div>
      </div>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Guide pages">
          {DOCS.map((d) => (
            <Link key={d.slug} href={`/admin/docs/${d.slug}`} aria-current={d.slug === current.slug ? "page" : undefined}>{d.title}</Link>
          ))}
          <a href="/api/docs/bundle.md" target="_blank" rel="noreferrer" style={{ marginTop: 8, color: "var(--muted)" }}>Open the full bundle <Icon name="external" size={13} /></a>
        </nav>
        <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </main>
  );
}
