"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, BrandMark, PasswordInput, Spinner } from "./ui";

export function JoinWorkspacePanel({ token, tenantName, email, role, expiresAt, signedInEmail }: {
  token: string;
  tenantName: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  signedInEmail: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = `/join?token=${encodeURIComponent(token)}`;
  const matches = signedInEmail?.toLowerCase() === email.toLowerCase();

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await api<{ tenantName?: string }>("/api/auth/workspace-invitations/accept", { method: "POST", body: { token } });
    if (!result.ok) {
      setError(result.data.error ?? "The invitation could not be accepted.");
      setBusy(false);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 12 || password.length > 200) {
      setError("Use a password between 12 and 200 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await api<{ tenantName?: string }>("/api/auth/workspace-invitations/create-account", { method: "POST", body: { token, password } });
    if (!result.ok) {
      setError(result.data.error ?? "The account could not be created.");
      setBusy(false);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  async function switchAccount() {
    const result = await api("/api/admin/logout", { method: "POST", body: {} });
    if (!result.ok) {
      setError(result.data.error ?? "Sign out before changing accounts.");
      return;
    }
    router.replace(`/admin/login?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  return (
    <section className="card auth-card">
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div>
          <h1>Join {tenantName}</h1>
          <p className="muted" style={{ marginTop: 4 }}>You were invited as a workspace {role} using {email}.</p>
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {signedInEmail && matches ? (
        <div className="stack">
          <p className="hint">This invitation expires {new Date(expiresAt).toLocaleDateString()}.</p>
          <button className="btn primary lg block" type="button" disabled={busy} onClick={() => void accept()}>{busy ? <Spinner /> : null} Join workspace</button>
        </div>
      ) : signedInEmail ? (
        <div className="stack">
          <p className="callout warn">You are signed in as {signedInEmail}. Sign in with {email} to accept this invitation.</p>
          <button className="btn primary lg block" type="button" onClick={() => void switchAccount()}>Switch account</button>
        </div>
      ) : (
        <form className="stack" onSubmit={createAccount}>
          <div className="callout">This invitation link verifies access to {email}. Choose a password to create your KQA account and join {tenantName}.</div>
          <div className="field"><label htmlFor="join-email">Invited email</label><input id="join-email" className="input" value={email} readOnly /></div>
          <div className="field"><label htmlFor="join-password">Password</label><PasswordInput id="join-password" className="input" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required /><span className="hint">Use at least 12 characters.</span></div>
          <div className="field"><label htmlFor="join-confirm">Confirm password</label><PasswordInput id="join-confirm" className="input" autoComplete="new-password" minLength={12} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
          <button className="btn primary lg block" disabled={busy || password.length < 12 || !confirmPassword}>{busy ? <Spinner /> : null} Create account and join</button>
          <p className="muted" style={{ textAlign: "center", fontSize: 13.5 }}>Already have an account? <Link href={`/admin/login?next=${encodeURIComponent(next)}`} style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>Sign in</Link></p>
        </form>
      )}
    </section>
  );
}
