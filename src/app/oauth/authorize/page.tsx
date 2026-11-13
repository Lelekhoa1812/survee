import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/ui";
import { adminSession } from "@/lib/http";
import { authorizeError, findClient, issueCode, requestOrigin } from "@/lib/mcp/oauth";

export const metadata = { title: "Connect an app" };
export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function originFrom(h: Headers): string {
  return requestOrigin(new Request("http://localhost/", { headers: h }));
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const clientId = one(q.client_id);
  const redirectUri = one(q.redirect_uri);
  const state = one(q.state);
  const challenge = one(q.code_challenge);
  const method = one(q.code_challenge_method) || "S256";
  const responseType = one(q.response_type) || "code";
  const client = await findClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return (
      <main className="center-page">
        <section className="card auth-card">
          <BrandMark size={40} wordmark />
          <div>
            <h1>This app cannot be connected</h1>
            <p className="muted" style={{ marginTop: 4 }}>The request did not match an app KQA has registered, so nothing was approved.</p>
          </div>
        </section>
      </main>
    );
  }
  const h = await headers();
  const origin = originFrom(new Headers(h));
  if (responseType !== "code" || method !== "S256" || !challenge) redirect(authorizeError(redirectUri, origin, "invalid_request", state));
  const session = await adminSession();
  if (!session) {
    const back = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256" });
    if (state) back.set("state", state);
    redirect(`/admin/login?next=${encodeURIComponent(`/oauth/authorize?${back}`)}`);
  }

  return (
    <main className="center-page">
      <section className="card auth-card">
        <BrandMark size={40} wordmark />
        <div>
          <h1>Connect {client.name}</h1>
          <p className="muted" style={{ marginTop: 4 }}>Signed in as {session.email}. This app can run every host action: interviews, people, answers, and invite links.</p>
        </div>
        <p>The connection is saved in Settings as a key. Revoke or delete that key to disconnect it. The value itself is not shown again.</p>
        <form action={decide} className="stack">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={challenge} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" name="decision" value="deny" type="submit">Cancel</button>
            <button className="btn primary" name="decision" value="allow" type="submit">Allow</button>
          </div>
        </form>
      </section>
    </main>
  );
}

async function decide(formData: FormData) {
  "use server";
  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
  const challenge = String(formData.get("code_challenge") ?? "");
  const client = await findClient(clientId);
  const h = await headers();
  const origin = originFrom(new Headers(h));
  if (!client || !client.redirectUris.includes(redirectUri)) redirect("/admin");
  const session = await adminSession();
  if (!session) {
    const back = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256" });
    if (state) back.set("state", state);
    redirect(`/admin/login?next=${encodeURIComponent(`/oauth/authorize?${back}`)}`);
  }
  if (String(formData.get("decision")) !== "allow" || !challenge) {
    redirect(authorizeError(redirectUri, origin, "access_denied", state));
  }
  const code = await issueCode({ clientId, redirectUri, challenge, email: session.email });
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("iss", origin);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}
