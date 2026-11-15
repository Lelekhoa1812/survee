"use client";

import Link from "next/link";
import { useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    const result = await api<{ message?: string }>("/api/auth/password-reset", { method: "POST", body: { email } });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "Password reset is temporarily unavailable.");
      return;
    }
    setMessage(result.data.message ?? "If the address belongs to a verified account, check its inbox.");
  }

  return (
    <form className="card auth-card" onSubmit={submit}>
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div><h1>Reset your password</h1><p className="muted" style={{ marginTop: 4 }}>We’ll email a one-time link if this address belongs to a verified KQA account.</p></div>
      </div>
      <div className="field">
        <label htmlFor="reset-email">Email</label>
        <input id="reset-email" className="input" type="email" autoComplete="email" maxLength={254} autoFocus value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p className="callout ok" role="status">{message}</p>}
      <button className="btn primary lg block" disabled={busy || !email}>{busy ? <Spinner /> : null} Send reset link</button>
      <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: 13.5 }}><Link href="/admin/login" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>Back to sign in</Link></p>
    </form>
  );
}
