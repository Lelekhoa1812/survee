"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, BrandMark, PasswordInput, Spinner } from "./ui";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await api("/api/admin/login", { method: "POST", body: { email, password } });
    if (res.ok) {
      router.replace(next);
      router.refresh();
    } else {
      setError(res.data.error ?? "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <form className="card auth-card" onSubmit={submit} noValidate>
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div>
          <h1>Host sign in</h1>
          <p className="muted" style={{ marginTop: 4 }}>Create interviews, review answers and export them.</p>
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <PasswordInput id="password" className="input" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} required />
      </div>
      <button className="btn primary lg block" disabled={busy || !email || !password}>
        {busy ? <Spinner /> : null} Sign in
      </button>
      <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: 13.5 }}>
        <Link href="/forgot-password" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>Forgot your password?</Link>
      </p>
      <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: 13.5 }}>
        New to survee? <Link href="/signup" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>Create a workspace</Link>
      </p>
    </form>
  );
}
