"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, BrandMark, Spinner } from "./ui";

export function VerifySignupForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setToken(params.get("token")?.slice(0, 128) ?? "");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function verify() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    const result = await api("/api/auth/verify", { method: "POST", body: { token } });
    if (!result.ok) {
      setError(result.data.error ?? "This link could not be verified.");
      setBusy(false);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <section className="card auth-card">
      <div className="stack" style={{ gap: 10 }}>
        <BrandMark size={40} wordmark />
        <div><h1>Verify your email</h1><p className="muted" style={{ marginTop: 4 }}>Select the button to verify the address and activate your workspace.</p></div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn primary lg block" type="button" disabled={!token || busy} onClick={() => void verify()}>
        {busy ? <Spinner /> : null} Verify and continue
      </button>
    </section>
  );
}
