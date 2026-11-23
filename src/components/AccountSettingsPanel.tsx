"use client";

import { useEffect, useState } from "react";
import { api, Badge, Icon, PasswordInput, Spinner, useToast } from "./ui";

interface AccountSettings {
  tenantName: string;
  email: string;
  role: string;
  emailVerified: boolean;
  legacyBootstrap: boolean;
}

export function AccountSettingsPanel({ account }: { account: AccountSettings }) {
  const toast = useToast();
  const [workspaceName, setWorkspaceName] = useState(account.tenantName);
  const [savedWorkspaceName, setSavedWorkspaceName] = useState(account.tenantName);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [sessions, setSessions] = useState<Array<{ current: boolean; createdAt: string; expiresAt: string }>>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");

  async function loadSessions() {
    setSessionsLoading(true);
    const result = await api<{ sessions: Array<{ current: boolean; createdAt: string; expiresAt: string }> }>("/api/admin/account/sessions");
    setSessionsLoading(false);
    if (!result.ok) {
      setSessionsError(result.data.error ?? "Sessions could not be loaded.");
      return;
    }
    setSessionsError("");
    setSessions(result.data.sessions ?? []);
  }

  useEffect(() => { void loadSessions(); }, []);

  async function renameWorkspace(event: React.FormEvent) {
    event.preventDefault();
    const name = workspaceName.trim();
    if (workspaceBusy || !name || name.length > 100 || name === savedWorkspaceName) return;
    setWorkspaceBusy(true);
    const result = await api<{ tenantName?: string }>("/api/admin/tenant", {
      method: "POST",
      body: { name },
    });
    setWorkspaceBusy(false);
    if (!result.ok) {
      toast(result.data.error ?? "The workspace name could not be updated.", "err");
      return;
    }
    const saved = result.data.tenantName ?? name;
    setWorkspaceName(saved);
    setSavedWorkspaceName(saved);
    toast("Workspace name updated.");
  }

  async function requestEmailChange(event: React.FormEvent) {
    event.preventDefault();
    if (emailBusy) return;
    setEmailBusy(true);
    setEmailMessage("");
    const result = await api<{ message?: string }>("/api/admin/account/email", {
      method: "POST",
      body: { currentPassword: emailPassword, email },
    });
    setEmailBusy(false);
    if (!result.ok) {
      toast(result.data.error ?? "The email could not be changed.", "err");
      return;
    }
    setEmailPassword("");
    setEmail("");
    setEmailMessage(result.data.message ?? "Check the new address for a verification link.");
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (passwordBusy) return;
    setPasswordError("");
    if (newPassword.length < 8 || newPassword.length > 200) {
      setPasswordError("Use a password between 8 and 200 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    const result = await api("/api/admin/account/password", {
      method: "POST",
      body: { currentPassword: password, newPassword },
    });
    setPasswordBusy(false);
    if (!result.ok) {
      setPasswordError(result.data.error ?? "The password could not be changed.");
      return;
    }
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast("Password updated.");
  }

  async function signOutOtherSessions() {
    if (sessionsBusy) return;
    setSessionsBusy(true);
    const result = await api("/api/admin/account/sessions", { method: "POST" });
    setSessionsBusy(false);
    if (!result.ok) {
      toast(result.data.error ?? "Other sessions could not be signed out.", "err");
      return;
    }
    window.location.reload();
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <Icon name="shield" size={16} />
        <div><h2>Workspace account</h2><div className="sub">{workspaceName} · {account.role}</div></div>
      </div>
      <div className="card-pad settings-grid">
        <div className="stack">
          {account.role === "owner" && <form className="stack" onSubmit={renameWorkspace}>
            <h3 style={{ fontSize: 15 }}>Workspace name</h3>
            <div className="field">
              <label htmlFor="workspace-name">Name</label>
              <input id="workspace-name" className="input" autoComplete="organization" maxLength={100} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required />
              <span className="hint">This name appears in the workspace and its settings.</span>
            </div>
            <button className="btn" disabled={workspaceBusy || !workspaceName.trim() || workspaceName.trim() === savedWorkspaceName}>{workspaceBusy ? <Spinner /> : null} Save workspace name</button>
          </form>}
          <div className="field">
            <span className="label">Sign-in email</span>
            <div className="row wrap"><strong>{account.email}</strong>{account.emailVerified ? <Badge kind="ok">Verified</Badge> : <Badge kind="warn">Unverified</Badge>}</div>
            {!account.emailVerified && <p className="hint">The legacy Axion address cannot receive email. Set a deliverable address to verify account recovery.</p>}
          </div>
          <form className="stack" onSubmit={requestEmailChange}>
            <h3 style={{ fontSize: 15 }}>Change email</h3>
            <div className="field">
              <label htmlFor="new-account-email">New email</label>
              <input id="new-account-email" className="input" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="email-current-password">Current password</label>
              <PasswordInput id="email-current-password" className="input" autoComplete="current-password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} required />
            </div>
            <button className="btn" disabled={emailBusy || !email || !emailPassword}>{emailBusy ? <Spinner /> : null} Send verification link</button>
            {emailMessage && <p className="callout ok" role="status">{emailMessage}</p>}
          </form>
        </div>
        <form className="stack" onSubmit={changePassword}>
          <h3 style={{ fontSize: 15 }}>Change password</h3>
          <div className="field">
            <label htmlFor="password-current">Current password</label>
            <PasswordInput id="password-current" className="input" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password-new">New password</label>
            <PasswordInput id="password-new" className="input" autoComplete="new-password" minLength={8} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            <span className="hint">Use at least 8 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="password-confirm">Confirm new password</label>
            <PasswordInput id="password-confirm" className="input" autoComplete="new-password" minLength={8} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </div>
          {passwordError && <p className="field-error" role="alert">{passwordError}</p>}
          <button className="btn" disabled={passwordBusy || !password || newPassword.length < 8 || !confirmPassword}>{passwordBusy ? <Spinner /> : null} Update password</button>
        </form>
      </div>
      <div className="card-pad stack" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="row between wrap">
          <div>
            <h3 style={{ fontSize: 15 }}>Signed-in sessions</h3>
            <p className="hint">This list shows at most 50 active sessions and may omit a sign-in if session tracking was temporarily unavailable. Signing out other sessions invalidates every other session for this account, including sessions not shown here and sessions issued before this list was introduced.</p>
          </div>
          <button className="btn" type="button" onClick={() => void signOutOtherSessions()} disabled={sessionsBusy}>
            {sessionsBusy ? <Spinner /> : null} Sign out other sessions
          </button>
        </div>
        {sessionsLoading ? <p className="muted">Loading sessions…</p> : sessionsError ? <p className="field-error" role="alert">{sessionsError}</p> : sessions.length === 0 ? <p className="muted">No active sessions are listed.</p> : (
          <ul className="stack" style={{ paddingLeft: 20 }}>
            {sessions.map((session, index) => <li key={index}>
              <strong>{session.current ? "This session" : "Another session"}</strong>
              <span className="muted"> · Signed in {new Date(session.createdAt).toLocaleString()} · Expires {new Date(session.expiresAt).toLocaleString()}</span>
            </li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
