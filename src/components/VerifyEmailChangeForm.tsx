"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

export function VerifyEmailChangeForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setToken(params.get("token")?.slice(0, 128) ?? "");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function verify() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    const result = await api<{ email?: string }>("/api/auth/verify-email", { method: "POST", body: { token } });
    if (!result.ok) {
      setError(result.data.error ?? "This link could not be verified.");
      setBusy(false);
      return;
    }
    setVerifiedEmail(result.data.email ?? "");
    setBusy(false);
  }

  return (
    <section className="card auth-card">
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div><h1>{verifiedEmail ? "Email verified" : "Verify your new email"}</h1><p className="muted" style={{ marginTop: 4 }}>{verifiedEmail ? `${verifiedEmail} is now the sign-in address for your account. For security, sign in again with this address.` : "Select the button to confirm this address for your survee account."}</p></div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {verifiedEmail ? (
        <button className="btn primary lg block" type="button" onClick={() => { router.replace("/admin/login"); router.refresh(); }}>Sign in with new email</button>
      ) : (
        <button className="btn primary lg block" type="button" disabled={!token || busy} onClick={() => void verify()}>
          {busy ? <Spinner /> : null} Verify and continue
        </button>
      )}
    </section>
  );
}
