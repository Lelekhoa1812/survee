"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

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
        <BrandMark size={40} />
        <div>
          <h1>Host sign in</h1>
          <p className="muted" style={{ marginTop: 4 }}>Create interviews, review answers and export them.</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className={`input ${error ? "error" : ""}`} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className={`input ${error ? "error" : ""}`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <span className="field-error" role="alert">{error}</span>}
      </div>
      <button className="btn primary lg block" disabled={busy || !email || !password}>
        {busy ? <Spinner /> : null} Sign in
      </button>
    </form>
  );
}
