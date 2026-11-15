"use client";

import { useState } from "react";
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
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");

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
    if (newPassword.length < 12 || newPassword.length > 200) {
      setPasswordError("Use a password between 12 and 200 characters.");
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

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <Icon name="shield" size={16} />
        <div><h2>Workspace account</h2><div className="sub">{account.tenantName} · {account.role}</div></div>
      </div>
      <div className="card-pad settings-grid">
        <div className="stack">
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
            <PasswordInput id="password-new" className="input" autoComplete="new-password" minLength={12} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            <span className="hint">Use at least 12 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="password-confirm">Confirm new password</label>
            <PasswordInput id="password-confirm" className="input" autoComplete="new-password" minLength={12} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </div>
          {passwordError && <p className="field-error" role="alert">{passwordError}</p>}
          <button className="btn" disabled={passwordBusy || !password || newPassword.length < 12 || !confirmPassword}>{passwordBusy ? <Spinner /> : null} Update password</button>
        </form>
      </div>
    </section>
  );
}
