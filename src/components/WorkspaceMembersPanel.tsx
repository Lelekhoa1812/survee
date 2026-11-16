"use client";

import { useEffect, useState } from "react";
import { api, Icon, Spinner, useToast } from "./ui";

interface WorkspaceMember { userId: string; email: string; role: string; createdAt: string }
interface PendingInvitation { id: string; email: string; role: "admin" | "member"; expiresAt: string }
interface AccessList { members?: WorkspaceMember[]; invitations?: PendingInvitation[] }

export function WorkspaceMembersPanel() {
  const toast = useToast();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const result = await api<AccessList>("/api/admin/workspace-invitations");
    setLoading(false);
    if (!result.ok) {
      setError(result.data.error ?? "Workspace access could not be loaded.");
      return;
    }
    setError("");
    setMembers(result.data.members ?? []);
    setInvitations(result.data.invitations ?? []);
  }

  useEffect(() => { void load(); }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError("");
    const result = await api<{ message?: string }>("/api/admin/workspace-invitations", { method: "POST", body: { email, role } });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "The invitation could not be sent.");
      return;
    }
    setEmail("");
    toast(result.data.message ?? "Invitation sent.");
    await load();
  }

  async function revoke(invitation: PendingInvitation) {
    if (busy) return;
    setBusy(true);
    const result = await api(`/api/admin/workspace-invitations/${invitation.id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "The invitation could not be revoked.");
      return;
    }
    toast(`Invitation to ${invitation.email} revoked.`);
    await load();
  }

  return (
    <section id="workspace-members" className="card settings-anchor" style={{ marginBottom: 16 }}>
      <div className="card-head"><Icon name="users" size={16} /><div><h2>Workspace members</h2><div className="sub">Invite people to share this workspace. One KQA account can belong to several workspaces.</div></div></div>
      <div className="card-pad stack">
        <form className="row wrap" onSubmit={invite} style={{ alignItems: "end" }}>
          <label className="field" style={{ flex: "2 1 230px", margin: 0 }}><span>Email address</span><input className="input" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field" style={{ flex: "1 1 150px", margin: 0 }}><span>Workspace role</span><select className="select" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "member")}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <button className="btn primary" disabled={busy || !email.trim()}>{busy ? <Spinner /> : null} Send invitation</button>
        </form>
        <p className="hint">The secure invitation link expires after 7 days. An invited person can create an account from that link or sign in with an existing account using the invited email.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        {loading ? <p className="muted" role="status"><Spinner /> Loading workspace access…</p> : (
          <div className="settings-grid" style={{ margin: 0 }}>
            <section className="stack" aria-labelledby="workspace-active-members"><h3 id="workspace-active-members">Members ({members.length})</h3>
              {members.length ? <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>{members.map((member) => <li key={member.userId} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: "8px 0" }}><span>{member.email}</span><span className="muted">{member.role}</span></li>)}</ul> : <p className="muted">No members are listed.</p>}
            </section>
            <section className="stack" aria-labelledby="workspace-pending-invites"><h3 id="workspace-pending-invites">Pending invitations ({invitations.length})</h3>
              {invitations.length ? <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>{invitations.map((invitation) => <li key={invitation.id} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: "8px 0" }}><span>{invitation.email}<small className="muted" style={{ display: "block" }}>{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></span><button className="btn sm" type="button" disabled={busy} onClick={() => void revoke(invitation)}>Revoke</button></li>)}</ul> : <p className="muted">No pending invitations.</p>}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
