"use client";

import { useMemo, useState } from "react";
import { api, Badge, CopyButton, Icon, Modal, Spinner, useToast } from "./ui";
import { fullTime, relTime } from "@/lib/time";
import { AccountSettingsPanel } from "./AccountSettingsPanel";
import { ImageAssetsPanel } from "./ImageAssetsPanel";
import { WorkspaceMembersPanel } from "./WorkspaceMembersPanel";
import { DEFAULT_MCP_CAPABILITIES, describeCapabilities, MCP_CAPABILITIES, MCP_CAPABILITY_INFO, type McpCapability } from "@/lib/mcp/capabilities";

interface KeyRow {
  id: string;
  name: string;
  note: string;
  prefix: string;
  suffix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
  via?: "key" | "oauth";
  capabilities?: McpCapability[];
}

interface TenantAudit {
  axionLegacyTenantFallbackEnabled: boolean;
  collections: Record<string, { documents: number; alreadyTenantScoped: number; missingTenant: number; otherTenant: number }>;
  blockingIntegrity: Record<string, number>;
  legacyEventReferences: Record<string, number>;
  preflight: { tenantIdsMatchAxion: boolean; readyForReviewedBackfill: boolean };
}

interface AccountSettings {
  tenantName: string;
  email: string;
  role: string;
  emailVerified: boolean;
  legacyBootstrap: boolean;
}

type Filter = "all" | KeyRow["status"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "revoked", label: "Revoked" },
  { id: "expired", label: "Expired" },
];

export function SettingsConsole({ initialKeys, loadError, canManageKeys, envToken, origin, tenantAudit: initialTenantAudit, tenantAuditError, mayManageLegacy, account }: { initialKeys: KeyRow[] | null; loadError: boolean; canManageKeys: boolean; envToken: boolean; origin: string | null; tenantAudit: TenantAudit | null; tenantAuditError: boolean; mayManageLegacy: boolean; account: AccountSettings | null }) {
  const toast = useToast();
  const [keys, setKeys] = useState<KeyRow[] | null>(initialKeys);
  const [failed, setFailed] = useState(loadError);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KeyRow | null>(null);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
  const [deleting, setDeleting] = useState<KeyRow | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; secret: string } | null>(null);
  const [tenantAudit, setTenantAudit] = useState<TenantAudit | null>(initialTenantAudit);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationPhrase, setMigrationPhrase] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  const endpoint = origin ? `${origin}/api/mcp` : null;
  const snippet = JSON.stringify({
    mcpServers: {
      kqa: {
        url: endpoint ?? "https://<your-host>/api/mcp",
        headers: { Authorization: "Bearer <paste a key>" },
      },
    },
  }, null, 2);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (keys ?? []).filter((key) => {
      if (filter !== "all" && key.status !== filter) return false;
      if (!q) return true;
      return `${key.name} ${key.note} ${key.prefix} ${key.suffix} ${key.createdBy}`.toLowerCase().includes(q);
    });
  }, [keys, filter, query]);

  const counts = useMemo(() => {
    const all = keys ?? [];
    return {
      all: all.length,
      active: all.filter((k) => k.status === "active").length,
      revoked: all.filter((k) => k.status === "revoked").length,
      expired: all.filter((k) => k.status === "expired").length,
    };
  }, [keys]);

  async function refresh() {
    const res = await api<{ keys?: KeyRow[] }>("/api/admin/keys");
    if (!res.ok || !res.data.keys) {
      setFailed(true);
      toast(res.data.error || "Could not load keys.", "err");
      return;
    }
    setFailed(false);
    setKeys(res.data.keys);
  }

  async function mutate(url: string, method: string, body?: unknown, done?: string) {
    setBusy(true);
    const res = await api<{ key?: KeyRow; secret?: string }>(url, { method, body });
    setBusy(false);
    if (!res.ok) {
      toast(res.data.error || "That could not be saved.", "err");
      return null;
    }
    if (done) toast(done);
    await refresh();
    return res.data;
  }

  const legacyCollections = ["interviews", "survey_versions", "participants", "events", "mail_messages", "api_keys", "oauth_codes"];
  const unscopedLegacyCount = legacyCollections.reduce((sum, name) => sum + (tenantAudit?.collections[name]?.missingTenant ?? 0), 0);
  const otherTenantCount = legacyCollections.reduce((sum, name) => sum + (tenantAudit?.collections[name]?.otherTenant ?? 0), 0);
  const integrityFindings = [
    ...Object.entries(tenantAudit?.blockingIntegrity ?? {}),
    ["eventsInterviewParticipantMismatch", tenantAudit?.legacyEventReferences.eventsInterviewParticipantMismatch ?? 0] as [string, number],
    ["eventsTenantMismatch", tenantAudit?.legacyEventReferences.eventsTenantMismatch ?? 0] as [string, number],
    ...legacyCollections.map((name) => [`${name}OtherTenant`, tenantAudit?.collections[name]?.otherTenant ?? 0] as [string, number]),
  ].filter(([, count]) => count > 0);

  async function assignLegacyData() {
    if (busy || migrationPhrase !== "ASSIGN LEGACY DATA TO AXION" || !backupConfirmed) return;
    setBusy(true);
    const result = await api<{ audit?: TenantAudit; modified?: Record<string, number> }>("/api/admin/tenant-migration", {
      method: "POST",
      body: { confirmation: migrationPhrase, backupConfirmed },
    });
    setBusy(false);
    if (!result.ok || !result.data.audit) {
      toast(result.data.error ?? "The legacy data could not be assigned.", "err");
      return;
    }
    setTenantAudit(result.data.audit);
    setMigrationPhrase("");
    setBackupConfirmed(false);
    setMigrationOpen(false);
    toast("Legacy records are assigned to Axion.");
  }

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>{canManageKeys ? "Manage your workspace account, connect an agent, and control named keys. The full value of a new key is shown once, then only a fingerprint remains." : "Manage your workspace account and connect an agent."}</p>
        </div>
        {canManageKeys && <button className="btn primary right" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New key</button>}
      </div>

      <nav className="settings-section-nav" aria-label="Settings sections">
        {account && <a href="#workspace-account">Workspace account</a>}
        {canManageKeys && <a href="#workspace-members">Members</a>}
        <a href="#agent-connection">Agent connection</a>
        <a href="#image-assets">Workspace images</a>
        {canManageKeys && <a href="#api-keys">API keys</a>}
        {mayManageLegacy && <a href="#legacy-data">Axion legacy data</a>}
      </nav>

      {account && <div id="workspace-account" className="settings-anchor"><AccountSettingsPanel account={account} /></div>}
      {canManageKeys && <WorkspaceMembersPanel />}

      <div id="agent-connection" className="settings-grid settings-anchor">
        <section className="card">
          <div className="card-head">
            <Icon name="link" size={16} />
            <div>
              <h2>Agent connection</h2>
              <div className="sub">ChatGPT uses this URL and then asks you to sign in. Other agents can send a key as a bearer token.</div>
            </div>
          </div>
          <div className="card-pad stack">
            <div className="field">
              <span className="label">Endpoint</span>
              {endpoint ? (
                <div className="row wrap endpoint-row" style={{ gap: 8 }}>
                  <code className="key-secret endpoint-url" style={{ flex: 1 }}>{endpoint}</code>
                  <CopyButton text={endpoint} label="Copy" className="btn sm" ariaLabel="Copy endpoint" />
                </div>
              ) : (
                <p className="hint">Set <span className="mono">KQA_PUBLIC_URL</span> to the public address of this app. Until then, use the host you are visiting plus <span className="mono">/api/mcp</span>.</p>
              )}
            </div>
            <div className="field">
              <span className="label">Client snippet</span>
              <pre className="key-secret" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{snippet}</pre>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="hint">Workspace keys and the Axion server token both use this endpoint. Do not put a bearer value in a repository.</span>
                <CopyButton text={snippet} label="Copy snippet" className="btn sm" ariaLabel="Copy client snippet" />
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <Icon name="shield" size={16} />
            <div>
              <h2>Server token</h2>
              <div className="sub">The deployment credential is bound to Axion. It is not listed here and cannot be revoked from this page.</div>
            </div>
          </div>
          <div className="card-pad stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 13 }}>KQA_MCP_TOKEN</span>
              {envToken ? <Badge kind="ok">Configured</Badge> : <Badge kind="warn">Not configured</Badge>}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              {envToken
                ? "This token always operates in the Axion workspace with full tool access. Rotate it in the host that runs this app. New named keys can be restricted to specific tasks."
                : "No environment token is set. Named keys are limited to this workspace and can be restricted to specific tasks."}
            </p>
          </div>
        </section>
      </div>

      <ImageAssetsPanel />

      {revealed && (
        <section className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>
          <div className="card-head">
            <Icon name="lock" size={16} />
            <div>
              <h2>Copy “{revealed.name}” now</h2>
              <div className="sub">This is the only time the full value is shown. Closing this panel hides it for good.</div>
            </div>
          </div>
          <div className="card-pad stack">
            <code className="key-secret">{revealed.secret}</code>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <CopyButton text={revealed.secret} label="Copy key" className="btn sm primary" ariaLabel="Copy the new key" />
              <button className="btn sm" type="button" onClick={() => setRevealed(null)}>I have stored it</button>
            </div>
          </div>
        </section>
      )}

      {canManageKeys && <section id="api-keys" className="card settings-anchor">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <Icon name="lock" size={16} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <h2>API keys</h2>
            <div className="sub">{counts.active} active · {counts.revoked} revoked · {counts.expired} expired</div>
          </div>
          <div className="seg" role="group" aria-label="Filter keys">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label} <span className="muted">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <input className="input" style={{ maxWidth: 220, height: 34 }} placeholder="Search name or note" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search keys" />
        </div>

        {failed || keys === null ? (
          <div className="card empty">
            <div className="ico"><Icon name="alert" size={22} /></div>
            <h3>Keys could not be loaded</h3>
            <p>The database did not answer. Nothing was changed.</p>
            <button className="btn" type="button" onClick={() => void refresh()}>Try again</button>
          </div>
        ) : keys.length === 0 ? (
          <div className="card empty" style={{ border: 0, boxShadow: "none" }}>
            <div className="ico"><Icon name="lock" size={22} /></div>
            <h3>No keys yet</h3>
            <p>A key grants only the permissions you select. New keys can list interviews and read aggregate analysis by default. Name each key after its agent or machine; you can change its permissions or revoke it without changing other workspace credentials.</p>
            <button className="btn primary" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Create a key</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="card-pad"><p className="muted" style={{ margin: 0 }}>No keys match this filter.</p></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="t cards">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Access</th>
                  <th>Note</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((key) => (
                  <tr key={key.id}>
                    <td className="c-main" data-label="Name">
                      <div className="name">{key.name} {key.via === "oauth" ? <Badge kind="info">Connected app</Badge> : null}</div>
                      <div className="desc">Added {relTime(key.createdAt)} · {key.createdBy}</div>
                    </td>
                    <td data-label="Value"><span className="code-chip" title="The full value is not stored">{key.prefix}…{key.suffix}</span></td>
                    <td data-label="Access"><span className="muted">{describeCapabilities(key.capabilities)}</span></td>
                    <td className="c-wide" data-label="Note"><span className="muted">{key.note || "—"}</span></td>
                    <td data-label="Last used"><span title={fullTime(key.lastUsedAt ?? undefined)}>{key.lastUsedAt ? relTime(key.lastUsedAt) : "Never"}</span></td>
                    <td data-label="Expires"><span title={fullTime(key.expiresAt ?? undefined)}>{key.expiresAt ? fullTime(key.expiresAt) : "None"}</span></td>
                    <td className="c-status" data-label="Status"><StatusBadge status={key.status} /></td>
                    <td className="c-actions" data-label="Actions">
                      <div className="row wrap" style={{ justifyContent: "flex-end" }}>
                        <button className="btn sm ghost" type="button" onClick={() => setEditing(key)}>Edit</button>
                        {key.status === "revoked" ? (
                          <button className="btn sm" type="button" disabled={busy} onClick={() => void mutate(`/api/admin/keys/${key.id}`, "PATCH", { revoked: false }, `Restored “${key.name}”.`)}>Restore</button>
                        ) : (
                          <button className="btn sm" type="button" onClick={() => setRevoking(key)}>Revoke</button>
                        )}
                        <button className="btn sm danger" type="button" onClick={() => setDeleting(key)} aria-label={`Delete ${key.name}`}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {mayManageLegacy && (
        <section id="legacy-data" className="card settings-legacy-section settings-anchor">
          <div className="card-head">
            <Icon name="shield" size={16} />
            <div><h2>Axion legacy data</h2><div className="sub">Owner-only review and assignment of existing host records.</div></div>
          </div>
          {tenantAuditError ? (
            <div className="card-pad"><p className="muted" role="status">The read-only migration audit could not reach the database.</p></div>
          ) : !tenantAudit ? (
            <div className="card-pad"><p className="muted" role="status">Migration counts are unavailable.</p></div>
          ) : (
            <div className="card-pad stack">
              <p className="settings-legacy-intro">Review the ownership audit here. No records change during this review; a separate owner-only assignment requires a typed confirmation and your attestation that a current database backup is available. The app cannot verify the backup.</p>
              {unscopedLegacyCount === 0 ? (
                otherTenantCount > 0
                  ? <p className="muted" role="status">{otherTenantCount.toLocaleString()} records already belong to another tenant and need review before Axion assignment.</p>
                  : tenantAudit.axionLegacyTenantFallbackEnabled
                    ? <p className="muted" role="status">All existing workspace records have tenant ownership. Axion’s legacy fallback remains enabled; after the reviewed backfill and a zero-unscoped audit, set <code>KQA_AXION_LEGACY_TENANT_FALLBACK=false</code> in Vercel and redeploy to enforce strict tenant filters.</p>
                    : <p className="muted" role="status">All existing workspace records have tenant ownership, and Axion uses strict tenant filters.</p>
              ) : (
                <p className="muted" role="status">{unscopedLegacyCount.toLocaleString()} existing records are still unscoped. {tenantAudit.axionLegacyTenantFallbackEnabled ? "They remain visible to Axion while the migration fallback is enabled." : "They are hidden from Axion queries while strict tenant filters are enabled."}</p>
              )}
              {tenantAudit.preflight.readyForReviewedBackfill ? (
                <div className="row wrap" style={{ justifyContent: "space-between" }}>
                  <span className="hint">The record links pass the integrity checks. Assignment adds Axion tenant IDs and preserves all records, including events with incomplete links.</span>
                  {unscopedLegacyCount > 0 && <button className="btn" type="button" onClick={() => setMigrationOpen(true)}>Review assignment</button>}
                </div>
              ) : (
                <div className="callout warn" role="alert">
                  <div><strong>Assignment is paused.</strong> The audit found records owned by another tenant or inconsistent record links that need review.</div>
                  {integrityFindings.length > 0 && <ul style={{ margin: "4px 0 0 18px" }}>{integrityFindings.map(([name, count]) => <li key={name}>{name}: {count.toLocaleString()}</li>)}</ul>}
                </div>
              )}
              {unscopedLegacyCount > 0 && (
                <p className="hint">
                  Legacy event references retained: {tenantAudit.legacyEventReferences.eventsWithoutInterview ?? 0} missing interviews, {tenantAudit.legacyEventReferences.eventsWithoutParticipant ?? 0} missing participants, and {tenantAudit.legacyEventReferences.eventsWithoutInterviewId ?? 0} without an interview ID. No records are deleted.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {canManageKeys && creating && (
        <KeyForm
          title="New key"
          busy={busy}
          onClose={() => { if (!busy) setCreating(false); }}
          onSubmit={async (draft) => {
            const data = await mutate("/api/admin/keys", "POST", draft);
            if (!data?.secret) return;
            setCreating(false);
            setRevealed({ name: data.key?.name || draft.name, secret: data.secret });
          }}
        />
      )}
      {canManageKeys && editing && (
        <KeyForm
          title={`Edit “${editing.name}”`}
          busy={busy}
          initial={editing}
          onClose={() => { if (!busy) setEditing(null); }}
          onSubmit={async (draft) => {
            const data = await mutate(`/api/admin/keys/${editing.id}`, "PATCH", { name: draft.name, note: draft.note, expiresAt: draft.expiresAt, capabilities: draft.capabilities }, `Saved “${draft.name}”.`);
            if (data) setEditing(null);
          }}
        />
      )}
      {canManageKeys && revoking && (
        <Modal
          title={`Revoke “${revoking.name}”`}
          onClose={() => { if (!busy) setRevoking(null); }}
          actions={
            <>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => setRevoking(null)}>Cancel</button>
              <button className="btn danger solid" type="button" disabled={busy} onClick={async () => {
                const data = await mutate(`/api/admin/keys/${revoking.id}`, "PATCH", { revoked: true }, `Revoked “${revoking.name}”.`);
                if (data) setRevoking(null);
              }}>{busy ? <Spinner /> : null} Revoke key</button>
            </>
          }
        >
          <p>Calls that use this key start failing immediately. The Axion server token is unchanged. You can restore the key later; restoring does not show the value again.</p>
        </Modal>
      )}
      {canManageKeys && deleting && (
        <DeleteKeyDialog
          name={deleting.name}
          busy={busy}
          onClose={() => { if (!busy) setDeleting(null); }}
          onConfirm={async () => {
            const data = await mutate(`/api/admin/keys/${deleting.id}`, "DELETE", {}, `Deleted “${deleting.name}”.`);
            if (data) setDeleting(null);
          }}
        />
      )}
      {migrationOpen && (
        <Modal
          title="Assign existing records to Axion?"
          onClose={() => { if (!busy) { setMigrationOpen(false); setMigrationPhrase(""); setBackupConfirmed(false); } }}
          actions={
            <>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => { setMigrationOpen(false); setMigrationPhrase(""); setBackupConfirmed(false); }}>Cancel</button>
              <button className="btn primary" type="button" disabled={busy || migrationPhrase !== "ASSIGN LEGACY DATA TO AXION" || !backupConfirmed} onClick={() => void assignLegacyData()}>{busy ? <Spinner /> : null} Assign records</button>
            </>
          }
        >
          <div className="stack">
            <p>This writes <code>tenantId: axion</code> onto {unscopedLegacyCount.toLocaleString()} existing records, including interviews, survey versions, participants, events, mail, API keys, and active OAuth codes. It preserves record IDs, answers, links, keys, and event history.</p>
            <p className="muted">The audit passed the parent-record checks. Legacy events with missing or incomplete references are retained and assigned to Axion.</p>
            <p className="callout warn">Verify a current MongoDB backup is available before continuing. This app cannot verify the backup itself.</p>
            <label className="row wrap" style={{ alignItems: "flex-start", gap: 8 }}>
              <input type="checkbox" checked={backupConfirmed} onChange={(event) => setBackupConfirmed(event.target.checked)} style={{ marginTop: 4 }} />
              <span>I verified a current database backup is available.</span>
            </label>
            <div className="field">
              <label htmlFor="migration-confirm">Type <code>ASSIGN LEGACY DATA TO AXION</code> to continue</label>
              <input id="migration-confirm" className="input" autoComplete="off" value={migrationPhrase} onChange={(event) => setMigrationPhrase(event.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: KeyRow["status"] }) {
  if (status === "active") return <Badge kind="ok">Active</Badge>;
  if (status === "expired") return <Badge kind="warn">Expired</Badge>;
  return <Badge kind="err">Revoked</Badge>;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function KeyForm({ title, busy, initial, onClose, onSubmit }: { title: string; busy: boolean; initial?: KeyRow; onClose: () => void; onSubmit: (draft: { name: string; note: string; value: string; expiresAt: string | null; capabilities: McpCapability[] }) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [expires, setExpires] = useState(toLocalInput(initial?.expiresAt ?? null));
  const [expiryMode, setExpiryMode] = useState<"never" | "scheduled">(initial?.expiresAt ? "scheduled" : "never");
  const [capabilities, setCapabilities] = useState<McpCapability[]>(initial?.capabilities ?? (initial ? [...MCP_CAPABILITIES] : [...DEFAULT_MCP_CAPABILITIES]));
  const [error, setError] = useState("");

  return (
    <Modal
      title={title}
      onClose={onClose}
      className="key-permission-modal"
      actions={
        <>
          <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn primary" type="button" disabled={busy} onClick={async () => {
            const trimmed = name.trim();
            if (!trimmed) { setError("Give the key a name."); return; }
            if (capabilities.length === 0) { setError("Select at least one permission."); return; }
            if (expiryMode === "scheduled" && !expires) { setError("Choose an expiry date, or select Never expires."); return; }
            if (value.trim() && value.trim().length < 32) { setError("A key value needs at least 32 characters, or leave it blank to generate one."); return; }
            if (/\s/.test(value)) { setError("A key value cannot contain spaces."); return; }
            setError("");
            await onSubmit({ name: trimmed, note: note.trim(), value: value.trim(), expiresAt: expiryMode === "scheduled" ? new Date(expires).toISOString() : null, capabilities });
          }}>{busy ? <Spinner /> : null} {initial ? "Save" : "Create key"}</button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Name</span>
          <input className={`input ${error && !name.trim() ? "error" : ""}`} value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Laptop agent" />
        </label>
        <label className="field">
          <span>Note</span>
          <textarea className="textarea" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="What this key is for" />
        </label>
        {!initial && (
          <div className="field">
            <span className="label">Value</span>
            <div className="row wrap key-value-row">
              <input className="input mono" style={{ flex: "1 1 130px", minWidth: 0, width: "auto" }} type={showValue ? "text" : "password"} autoComplete="off" spellCheck={false} value={value} maxLength={256} onChange={(e) => setValue(e.target.value)} placeholder="Leave blank to generate" aria-label="Key value" />
              <button className="btn sm" type="button" onClick={() => setShowValue((v) => !v)}>{showValue ? "Hide" : "Show"}</button>
              <button className="btn sm" type="button" onClick={() => { setValue(generateLocal()); setShowValue(true); }}>Generate</button>
            </div>
            <span className="hint">At least 32 characters, no spaces. Generating here lets you copy it before you save. The server still shows it once after creation.</span>
          </div>
        )}
        <fieldset className="stack" style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
          <legend className="label" style={{ padding: "0 5px" }}>Permissions</legend>
          {initial && initial.capabilities === undefined && <p className="callout warn" style={{ margin: 0 }}>This existing key has full legacy access. The selected permissions take effect as soon as you save.</p>}
          {!initial && <p className="hint" style={{ margin: 0 }}>New keys start with interview and aggregate-analysis read access. Add only what this agent needs.</p>}
          {MCP_CAPABILITIES.map((capability) => (
            <label key={capability} className="row wrap" style={{ alignItems: "flex-start", gap: 9 }}>
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={(event) => setCapabilities((current) => event.target.checked
                  ? [...current, capability]
                  : current.filter((item) => item !== capability))}
                style={{ marginTop: 4 }}
              />
              <span style={{ flex: 1, minWidth: 190 }}>
                <strong style={{ display: "block" }}>{MCP_CAPABILITY_INFO[capability].label}</strong>
                <span className="hint">{MCP_CAPABILITY_INFO[capability].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Expiry</span>
          <select className="select" value={expiryMode} onChange={(event) => setExpiryMode(event.target.value as "never" | "scheduled")}>
            <option value="never">Never expires</option>
            <option value="scheduled">Set an expiry date</option>
          </select>
          {expiryMode === "scheduled" && <input className="input" type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} aria-label="Key expiry date and time" required />}
          <span className="hint">{expiryMode === "scheduled" ? "The key stops working after this moment. Revoke is separate and can be undone." : "The key keeps working until you revoke it."}</span>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

function generateLocal(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `kqa_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")}`;
}

function DeleteKeyDialog({ name, busy, onClose, onConfirm }: { name: string; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const ready = typed.trim() === name;
  return (
    <Modal
      title={`Delete “${name}”`}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn danger solid" type="button" disabled={busy || !ready} onClick={() => void onConfirm()}>{busy ? <Spinner /> : null} Delete forever</button>
        </>
      }
    >
      <div className="stack">
        <p>This removes the key. It cannot be restored, and the value cannot be shown again. Interviews and answers are not deleted.</p>
        <label className="field">
          <span>Type <span className="mono">{name}</span> to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Type the key name to confirm deletion" />
        </label>
      </div>
    </Modal>
  );
}
