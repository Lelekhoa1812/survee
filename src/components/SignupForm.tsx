"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

type SignupField = "tenantName" | "email" | "password";
type SignupFieldErrors = Partial<Record<SignupField, string>>;

export function SignupForm() {
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [sent, setSent] = useState(false);
  const tenantNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fieldErrors.tenantName) tenantNameRef.current?.focus();
    else if (fieldErrors.email) emailRef.current?.focus();
    else if (fieldErrors.password) passwordRef.current?.focus();
  }, [fieldErrors]);

  function clearFieldError(field: SignupField) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    setFieldErrors({});
    const result = await api<{ message?: string; field?: string }>("/api/auth/signup", { method: "POST", body: { tenantName, email, password } });
    setBusy(false);
    if (!result.ok) {
      const message = result.data.error ?? "Signup could not be completed.";
      if (result.data.field === "tenantName" || result.data.field === "email" || result.data.field === "password") {
        setFieldErrors({ [result.data.field]: message });
      } else {
        setFormError(message);
      }
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <section className="card auth-card" aria-live="polite">
        <div className="stack" style={{ gap: 10 }}>
          <BrandMark size={40} wordmark />
          <div><h1>Check your email</h1><p className="muted" style={{ marginTop: 4 }}>If this address is eligible for a KQA workspace, check your inbox for next steps.</p></div>
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
      {formError && <p className="field-error" role="alert">{formError}</p>}
      <div className="field">
        <label htmlFor="tenantName">Workspace name</label>
        <input ref={tenantNameRef} id="tenantName" className={`input ${fieldErrors.tenantName ? "error" : ""}`} autoComplete="organization" maxLength={100} value={tenantName} onChange={(event) => { setTenantName(event.target.value); clearFieldError("tenantName"); }} required aria-invalid={!!fieldErrors.tenantName} aria-describedby={fieldErrors.tenantName ? "tenantName-error" : undefined} />
        {fieldErrors.tenantName && <span id="tenantName-error" className="field-error">{fieldErrors.tenantName}</span>}
      </div>
      <div className="field">
        <label htmlFor="signupEmail">Email</label>
        <input ref={emailRef} id="signupEmail" className={`input ${fieldErrors.email ? "error" : ""}`} type="email" autoComplete="email" maxLength={254} autoFocus value={email} onChange={(event) => { setEmail(event.target.value); clearFieldError("email"); }} required aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "signupEmail-error" : undefined} />
        {fieldErrors.email && <span id="signupEmail-error" className="field-error">{fieldErrors.email}</span>}
      </div>
      <div className="field">
        <label htmlFor="signupPassword">Password</label>
        <input ref={passwordRef} id="signupPassword" className={`input ${fieldErrors.password ? "error" : ""}`} type="password" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => { setPassword(event.target.value); clearFieldError("password"); }} required aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? "signupPassword-hint signupPassword-error" : "signupPassword-hint"} />
        <span id="signupPassword-hint" className="hint">Use at least 12 characters.</span>
        {fieldErrors.password && <span id="signupPassword-error" className="field-error">{fieldErrors.password}</span>}
      </div>
      <button className="btn primary lg block" disabled={busy || !tenantName.trim() || !email || password.length < 12}>
        {busy ? <Spinner /> : null} Create workspace
      </button>
      <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: 13.5 }}>Already have an account? <Link href="/admin/login" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>Sign in</Link></p>
    </form>
  );
}
