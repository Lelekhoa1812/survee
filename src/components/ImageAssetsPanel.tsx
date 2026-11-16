"use client";

import { useEffect, useState } from "react";
import { api, CopyButton, Icon, Modal, Spinner, useToast } from "./ui";
import { IMAGE_ASSET_ACCEPT, MAX_IMAGE_BYTES, type ImageAssetSummary } from "@/lib/image-assets";

interface Page {
  assets?: ImageAssetSummary[];
  nextCursor?: string | null;
}

export function ImageAssetsPanel({ canManage = true }: { canManage?: boolean }) {
  const toast = useToast();
  const [assets, setAssets] = useState<ImageAssetSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [deleting, setDeleting] = useState<ImageAssetSummary | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const cursor = cursors[cursors.length - 1] ?? null;

  async function load() {
    setLoading(true);
    const query = new URLSearchParams({ limit: "30" });
    if (cursor) query.set("cursor", cursor);
    const result = await api<Page & { error?: string }>(`/api/admin/assets?${query.toString()}`);
    setLoading(false);
    if (!result.ok || !result.data.assets) {
      toast(result.data.error || "Could not load workspace images.", "err");
      return;
    }
    setAssets(result.data.assets);
    setNextCursor(result.data.nextCursor ?? null);
  }

  useEffect(() => { void load(); }, [cursor]);

  async function upload() {
    if (!file || busy) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`, "err");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("name", name.trim() || file.name);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/assets", { method: "POST", body: form, credentials: "same-origin" });
      const data = await response.json().catch(() => ({})) as { asset?: ImageAssetSummary; error?: string };
      if (!response.ok || !data.asset) {
        toast(data.error || "The image could not be saved.", "err");
        return;
      }
      setName("");
      setFile(null);
      setFileInputKey((current) => current + 1);
      const wasFirstPage = cursor === null;
      setCursors([null]);
      toast("Image saved to the workspace library.");
      if (wasFirstPage) await load();
    } catch {
      toast("Could not reach the server. Check your connection and try again.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function rename(asset: ImageAssetSummary, value: string) {
    const result = await api<{ asset?: ImageAssetSummary }>(`/api/admin/assets/${asset.id}`, { method: "PATCH", body: { name: value } });
    if (!result.ok || !result.data.asset) {
      toast(result.data.error || "The image name could not be saved.", "err");
      return;
    }
    setAssets((current) => current.map((item) => item.id === asset.id ? result.data.asset! : item));
    toast("Image name saved.");
  }

  async function remove() {
    if (!deleting || confirmName !== deleting.name || busy) return;
    setBusy(true);
    const result = await api(`/api/admin/assets/${deleting.id}`, { method: "DELETE", body: { confirmName } });
    setBusy(false);
    if (!result.ok) {
      toast(result.data.error || "The image could not be deleted.", "err");
      return;
    }
    setDeleting(null);
    setConfirmName("");
    toast("Image deleted.");
    await load();
  }

  function changePage(next: string | null) {
    setCursors((current) => [...current, next]);
  }

  return (
    <>
      <section id="image-assets" className="card settings-anchor">
        <div className="card-head">
          <Icon name="upload" size={16} />
          <div>
            <h2>Workspace images</h2>
            <div className="sub">Store images once and reuse their URL in any questionnaire. There is no image-count limit.</div>
          </div>
        </div>
        <div className="card-pad stack">
          <p className="hint" style={{ margin: 0 }}>PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, and SVG are supported. Each image can be up to {MAX_IMAGE_BYTES / 1024 / 1024} MB. Image URLs can be opened by anyone who has the URL so respondents can load them. Upload a replacement as a new image to keep saved questionnaire versions reproducible.</p>
          {!canManage && <p className="hint" style={{ margin: 0 }}>Member access is view-only. Ask a workspace owner or admin to add, rename, or remove images.</p>}
          {canManage && <div className="row wrap" style={{ alignItems: "end" }}>
            <label className="field" style={{ flex: "1 1 180px", margin: 0 }}>
              <span>Image name</span>
              <input className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Use file name if blank" />
            </label>
            <label className="field" style={{ flex: "2 1 260px", margin: 0 }}>
              <span>Image file</span>
              <input key={fileInputKey} className="input" type="file" accept={IMAGE_ASSET_ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <button className="btn primary" type="button" disabled={!file || busy} onClick={() => void upload()}>{busy ? <Spinner /> : <Icon name="upload" size={15} />} Save image</button>
          </div>}
          {file && <div className="hint" role="status">Selected {file.name} · {(file.size / 1024).toFixed(0)} KB</div>}
          <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Saved images</h3>
            <button className="btn sm" type="button" disabled={loading} onClick={() => void load()}>Refresh</button>
          </div>
          {loading ? <div className="muted" role="status"><Spinner /> Loading images…</div> : assets.length === 0 ? (
            <div className="card empty" style={{ border: 0, boxShadow: "none" }}>
              <div className="ico"><Icon name="upload" size={20} /></div>
              <h3>{cursor ? "No more images" : "No workspace images yet"}</h3>
              <p>{canManage ? "Save an image above, then copy its URL or HTML snippet into your questionnaire." : "Workspace images will appear here when an owner or admin adds them."}</p>
            </div>
          ) : (
            <div className="stack">
              {assets.map((asset) => <AssetRow key={asset.id} asset={asset} canManage={canManage} onRename={rename} onDelete={() => { setDeleting(asset); setConfirmName(""); }} />)}
            </div>
          )}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="btn sm" type="button" disabled={cursors.length <= 1 || loading} onClick={() => setCursors((current) => current.slice(0, -1))}>Previous images</button>
            <button className="btn sm" type="button" disabled={!nextCursor || loading} onClick={() => changePage(nextCursor)}>More images</button>
          </div>
        </div>
      </section>
      {canManage && deleting && <Modal
        title={`Delete “${deleting.name}”?`}
        onClose={() => { if (!busy) { setDeleting(null); setConfirmName(""); } }}
        actions={<>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setDeleting(null); setConfirmName(""); }}>Cancel</button>
          <button className="btn danger solid" type="button" disabled={busy || confirmName !== deleting.name} onClick={() => void remove()}>{busy ? <Spinner /> : null} Delete image</button>
        </>}
      >
        <div className="stack">
          <p>Deletion permanently removes this image URL. KQA will block deletion while a saved questionnaire or active preview still uses it.</p>
          <label className="field"><span>Type <strong>{deleting.name}</strong> to confirm</span><input className="input" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" /></label>
        </div>
      </Modal>}
    </>
  );
}

function AssetRow({ asset, canManage, onRename, onDelete }: { asset: ImageAssetSummary; canManage: boolean; onRename: (asset: ImageAssetSummary, name: string) => Promise<void>; onDelete: () => void }) {
  const [name, setName] = useState(asset.name);
  const alt = asset.name.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  const snippet = `<img src="${asset.url}" alt="${alt}">`;
  return (
    <article className="card-pad" style={{ display: "grid", gridTemplateColumns: "minmax(96px, 150px) minmax(0, 1fr)", gap: 14, alignItems: "center", border: "1px solid var(--line)", borderRadius: 12 }}>
      {/* The image is an intentional same-origin preview of this workspace asset. */}
      <img src={asset.url} alt={`Preview of ${asset.name}`} style={{ width: "100%", height: 100, objectFit: "contain", background: "var(--surface-2)", borderRadius: 8 }} />
      <div className="stack" style={{ minWidth: 0, gap: 8 }}>
        {canManage ? <div className="row wrap" style={{ alignItems: "end" }}>
          <label className="field" style={{ flex: "1 1 180px", margin: 0 }}><span>Image name</span><input className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <button className="btn sm" type="button" disabled={!name.trim() || name === asset.name} onClick={() => void onRename(asset, name)}>Save name</button>
          <button className="btn sm danger" type="button" onClick={onDelete}>Delete</button>
        </div> : <strong>{asset.name}</strong>}
        <div className="hint" style={{ overflowWrap: "anywhere" }}>{asset.fileName} · {asset.mimeType} · {(asset.bytes / 1024).toFixed(0)} KB</div>
        <div className="row wrap">
          <code className="key-secret" style={{ flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" }}>{asset.url}</code>
          <CopyButton text={asset.url} label="Copy URL" className="btn sm" ariaLabel={`Copy image URL for ${asset.name}`} />
          <CopyButton text={snippet} label="Copy HTML" className="btn sm" ariaLabel={`Copy image HTML for ${asset.name}`} />
        </div>
      </div>
    </article>
  );
}
