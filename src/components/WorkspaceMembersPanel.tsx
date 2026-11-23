"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Icon, Modal, Spinner, useToast } from "./ui";

interface WorkspaceMember { userId: string; email: string; role: string; createdAt: string }
interface PendingInvitation { id: string; email: string; role: "admin" | "member"; expiresAt: string; mailStatus?: "pending" | "sent"; delivery?: "delivered" | "bounced" | "unknown"; deliveryCheckedAt?: string; canCheckDelivery?: boolean }
interface InvitationHistoryEntry { id: string; invitationId: string; type: "workspace_invitation_created" | "workspace_invitation_accepted" | "workspace_invitation_revoked"; at: string; actorUserId: string; targetUserId?: string; role: "admin" | "member" }
interface AccessList { members?: WorkspaceMember[]; invitations?: PendingInvitation[]; invitationHistory?: InvitationHistoryEntry[]; ownerCount?: number }

export function WorkspaceMembersPanel({ role: workspaceRole, userId }: { role: string; userId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [invitationHistory, setInvitationHistory] = useState<InvitationHistoryEntry[]>([]);
  const [ownerCount, setOwnerCount] = useState(0);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [transferring, setTransferring] = useState<WorkspaceMember | null>(null);
  const [roleEditing, setRoleEditing] = useState<WorkspaceMember | null>(null);
  const [nextRole, setNextRole] = useState<"admin" | "member">("member");
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
    setInvitationHistory(result.data.invitationHistory ?? []);
    setOwnerCount(result.data.ownerCount ?? (result.data.members ?? []).filter((member) => member.role === "owner").length);
  }

  useEffect(() => { void load(); }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError("");
    const result = await api<{ message?: string; code?: string }>("/api/admin/workspace-invitations", { method: "POST", body: { email, role } });
    setBusy(false);
    if (!result.ok) {
      const message = result.data.error ?? "The invitation could not be sent.";
      if (result.status === 409 || result.data.code === "delivery_unknown") await load();
      setError(message);
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

  async function checkDelivery(invitation: PendingInvitation) {
    if (busy) return;
    setBusy(true);
    const result = await api<{ delivery?: PendingInvitation["delivery"]; checkedAt?: string }>(`/api/admin/workspace-invitations/${invitation.id}/delivery`, { method: "POST" });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "Invitation delivery could not be checked.");
      return;
    }
    setInvitations((current) => current.map((item) => item.id === invitation.id
      ? { ...item, delivery: result.data.delivery, deliveryCheckedAt: result.data.checkedAt }
      : item));
    toast(result.data.delivery === "delivered" ? "The mail server confirmed delivery." : result.data.delivery === "bounced" ? "The mail server reported a bounce." : "Delivery is not confirmed yet.");
  }

  async function remove(member: WorkspaceMember) {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await api(`/api/admin/workspace-members/${encodeURIComponent(member.userId)}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "Workspace access could not be removed.");
      setRemoving(null);
      return;
    }
    setRemoving(null);
    toast(`${member.email} no longer has access to this workspace.`);
    await load();
  }

  async function transferOwnership(member: WorkspaceMember) {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await api("/api/admin/workspaces/transfer-ownership", { method: "POST", body: { targetUserId: member.userId } });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "Workspace ownership could not be changed.");
      setTransferring(null);
      return;
    }
    setTransferring(null);
    toast(`Ownership transferred to ${member.email}. Your role is now admin.`);
    router.refresh();
  }

  async function changeRole(member: WorkspaceMember) {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await api(`/api/admin/workspace-members/${encodeURIComponent(member.userId)}`, { method: "PATCH", body: { role: nextRole } });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "Workspace access could not be changed.");
      setRoleEditing(null);
      return;
    }
    setRoleEditing(null);
    toast(`${member.email} is now a workspace ${nextRole}.`);
    await load();
  }

  const canManageOwners = workspaceRole === "owner";

  return (
    <section id="workspace-members" className="card settings-anchor" style={{ marginBottom: 16 }}>
      <div className="card-head"><Icon name="users" size={16} /><div><h2>Workspace members</h2><div className="sub">Invite people to share this workspace. One survee account can belong to several workspaces.</div></div></div>
      <div className="card-pad stack">
        <form className="row wrap" onSubmit={invite} style={{ alignItems: "end" }}>
          <label className="field" style={{ flex: "2 1 230px", margin: 0 }}><span>Email address</span><input className="input" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field" style={{ flex: "1 1 150px", margin: 0 }}><span>Workspace role</span><select className="select" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "member")}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <button className="btn primary" disabled={busy || !email.trim()}>{busy ? <Spinner /> : null} Send invitation</button>
        </form>
        <p className="hint">The secure invitation link expires after 7 days. An invited person can create an account from that link or sign in with an existing account using the invited email. Active links stay valid until they expire or you revoke them; revoke a pending link before sending a replacement.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        {loading ? <p className="muted" role="status"><Spinner /> Loading workspace access…</p> : (
          <div className="settings-grid" style={{ margin: 0 }}>
            <section className="stack" aria-labelledby="workspace-active-members"><h3 id="workspace-active-members">Members ({members.length})</h3>
              {members.length ? <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>{members.map((member) => {
                const canRemove = member.userId !== userId && (member.role !== "owner" || (canManageOwners && ownerCount > 1));
                return <li key={member.userId} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                  <span>{member.email}{member.userId === userId && <small className="muted"> · You</small>}</span>
                  <span className="row wrap" style={{ justifyContent: "flex-end" }}><span className="muted">{member.role}</span>{canManageOwners && member.userId !== userId && member.role !== "owner" && <button className="btn sm" type="button" disabled={busy} onClick={() => { setRoleEditing(member); setNextRole(member.role === "admin" ? "admin" : "member"); }}>Change role</button>}{canManageOwners && member.userId !== userId && <button className="btn sm" type="button" disabled={busy} onClick={() => setTransferring(member)}>Make owner</button>}{canRemove
                    ? <button className="btn sm danger" type="button" disabled={busy} onClick={() => setRemoving(member)}>Remove access</button>
                    : member.role === "owner" && ownerCount <= 1
                      ? <small className="muted">Last owner</small>
                      : null}</span>
                </li>;
              })}</ul> : <p className="muted">No members are listed.</p>}
              <p className="hint">Removing someone revokes access to this workspace and linked OAuth connections. Their survee account and membership in other workspaces remain.</p>
            </section>
            <section className="stack" aria-labelledby="workspace-pending-invites"><h3 id="workspace-pending-invites">Pending invitations ({invitations.length})</h3>
              {invitations.length ? <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>{invitations.map((invitation) => {
                const deliveryLabel = invitation.delivery === "delivered" ? "delivery confirmed" : invitation.delivery === "bounced" ? "bounced" : invitation.mailStatus === "pending" ? "send outcome unknown" : invitation.mailStatus === "sent" ? "delivery unconfirmed" : "delivery status unavailable";
                return <li key={invitation.id} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: "8px 0" }}><span>{invitation.email}<small className="muted" style={{ display: "block" }}>{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()} · {deliveryLabel}{invitation.deliveryCheckedAt ? ` · checked ${new Date(invitation.deliveryCheckedAt).toLocaleString()}` : ""}</small></span><span className="row wrap">{invitation.canCheckDelivery && <button className="btn sm" type="button" disabled={busy} onClick={() => void checkDelivery(invitation)}>Check delivery</button>}<button className="btn sm" type="button" disabled={busy} onClick={() => void revoke(invitation)}>Revoke</button></span></li>;
              })}</ul> : <p className="muted">No pending invitations.</p>}
            </section>
            <section className="stack" aria-labelledby="workspace-invitation-history"><h3 id="workspace-invitation-history">Recent invitation history</h3>
              {invitationHistory.length ? <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>{invitationHistory.map((event) => {
                const accountLabel = (id: string) => id === userId ? "you" : members.find((member) => member.userId === id)?.email ?? `account …${id.slice(-6)}`;
                const description = event.type === "workspace_invitation_created"
                  ? `${accountLabel(event.actorUserId)} invited someone as ${event.role}`
                  : event.type === "workspace_invitation_accepted"
                    ? `${accountLabel(event.targetUserId ?? event.actorUserId)} accepted a ${event.role} invitation`
                    : `${accountLabel(event.actorUserId)} revoked a ${event.role} invitation`;
                return <li key={event.id} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: "8px 0" }}><span>{description}<small className="muted" style={{ display: "block" }}>Invitation ending …{event.invitationId.slice(-6)}</small></span><time className="muted" dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>;
              })}</ul> : <p className="muted">No invitation history in the last 180 days.</p>}
              <p className="hint">Recent create, accept, and revoke actions are retained for up to 180 days. Invitation links and recipient email addresses are not stored in this history.</p>
            </section>
          </div>
        )}
      </div>
      {removing && <Modal
        title={`Remove ${removing.email} from this workspace?`}
        onClose={() => { if (!busy) setRemoving(null); }}
        actions={<>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn danger solid" type="button" disabled={busy} onClick={() => void remove(removing)}>{busy ? <Spinner /> : null} Remove access</button>
        </>}
      >
        <p>This ends their access to this workspace, including OAuth connections linked to their membership. Their survee account and access to other workspaces will remain.</p>
        {removing.role === "owner" && <p className="callout warn">The workspace must keep at least one owner. Only an owner can remove another owner.</p>}
      </Modal>}
      {transferring && <Modal
        title={`Transfer workspace ownership to ${transferring.email}?`}
        onClose={() => { if (!busy) setTransferring(null); }}
        actions={<>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setTransferring(null)}>Cancel</button>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void transferOwnership(transferring)}>{busy ? <Spinner /> : null} Transfer ownership</button>
        </>}
      >
        <p>{transferring.email} will become an owner of this workspace. Your role will change to admin, so you will keep access but no longer manage ownership.</p>
      </Modal>}
      {roleEditing && <Modal
        title={`Change ${roleEditing.email}'s workspace role?`}
        onClose={() => { if (!busy) setRoleEditing(null); }}
        actions={<>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setRoleEditing(null)}>Cancel</button>
          <button className="btn primary" type="button" disabled={busy || nextRole === roleEditing.role} onClick={() => void changeRole(roleEditing)}>{busy ? <Spinner /> : null} Save role</button>
        </>}
      >
        <label className="field"><span>Workspace role</span><select className="select" value={nextRole} onChange={(event) => setNextRole(event.target.value === "admin" ? "admin" : "member")}><option value="member">Member</option><option value="admin">Admin</option></select></label>
        <p>Only workspace owners can change roles. Ownership uses the separate handoff action.</p>
      </Modal>}
    </section>
  );
}
