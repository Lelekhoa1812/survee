"use client";

import Link from "next/link";
import { useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

export function SignupForm() {
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await api<{ message?: string }>("/api/auth/signup", { method: "POST", body: { tenantName, email, password } });
    setBusy(false);
    if (!result.ok) {
      setError(result.data.error ?? "Signup could not be completed.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <section className="card auth-card" aria-live="polite">
        <div className="stack" style={{ gap: 10 }}>
          <BrandMark size={40} wordmark />
          <div><h1>Check your email</h1><p className="muted" style={{ marginTop: 4 }}>If this address can create an account, a verification link is on its way. It expires in 30 minutes.</p></div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}><Link href="/admin/login" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Return to sign in</Link></p>
      </section>
    );
  }

  return (
    <form className="card auth-card" onSubmit={submit} noValidate>
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div><h1>Create a KQA workspace</h1><p className="muted" style={{ marginTop: 4 }}>Verify your email to start hosting interviews.</p></div>
      </div>
      <div className="field">
        <label htmlFor="tenantName">Workspace name</label>
        <input id="tenantName" className="input" autoComplete="organization" maxLength={100} value={tenantName} onChange={(event) => setTenantName(event.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="signupEmail">Email</label>
        <input id="signupEmail" className={`input ${error ? "error" : ""}`} type="email" autoComplete="email" maxLength={254} autoFocus value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="signupPassword">Password</label>
        <input id="signupPassword" className={`input ${error ? "error" : ""}`} type="password" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required />
        <span className="hint">Use at least 12 characters.</span>
        {error && <span className="field-error" role="alert">{error}</span>}
      </div>
      <button className="btn primary lg block" disabled={busy || !tenantName.trim() || !email || password.length < 12}>
        {busy ? <Spinner /> : null} Create workspace
      </button>
      <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: 13.5 }}>Already have an account? <Link href="/admin/login" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>Sign in</Link></p>
    </form>
  );
}
