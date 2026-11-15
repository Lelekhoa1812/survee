"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

export function ResetPasswordForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setToken(params.get("token")?.slice(0, 128) ?? "");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !token) return;
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await api("/api/auth/password-reset/complete", { method: "POST", body: { token, password } });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "That password reset link could not be used.");
      return;
    }
    setPassword("");
    setConfirm("");
    setComplete(true);
  }

  return (
    <form className="card auth-card" onSubmit={submit}>
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div><h1>{complete ? "Password updated" : "Choose a new password"}</h1><p className="muted" style={{ marginTop: 4 }}>{complete ? "Sign in with your new password. Other signed-in sessions have been expired." : "The reset link can be used once and expires after 30 minutes."}</p></div>
      </div>
      {complete ? (
        <Link className="btn primary lg block" href="/admin/login">Continue to sign in</Link>
      ) : !token ? (
        <div className="stack"><p className="field-error" role="alert">This reset link is missing or invalid.</p><Link className="btn block" href="/forgot-password">Request another link</Link></div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="reset-new-password">New password</label>
            <input id="reset-new-password" className="input" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required />
            <span className="hint">Use at least 12 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="reset-confirm-password">Confirm new password</label>
            <input id="reset-confirm-password" className="input" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="btn primary lg block" disabled={busy || password.length < 12 || !confirm}>{busy ? <Spinner /> : null} Update password</button>
        </>
      )}
    </form>
  );
}
