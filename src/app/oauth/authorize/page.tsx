import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/ui";
import { adminSession } from "@/lib/http";
import { allowedMcpCapabilitiesForRole, canGrantMcpCapabilitiesForRole, DEFAULT_MCP_CAPABILITIES, MCP_CAPABILITY_INFO, parseMcpCapabilities } from "@/lib/mcp/capabilities";
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
  if (responseType !== "code" || method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) redirect(authorizeError(redirectUri, origin, "invalid_request", state));
  const session = await adminSession();
  if (!session) {
    const back = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256" });
    if (state) back.set("state", state);
    redirect(`/admin/login?next=${encodeURIComponent(`/oauth/authorize?${back}`)}`);
  }
  const availableCapabilities = allowedMcpCapabilitiesForRole(session.role);

  return (
    <main className="center-page">
      <section className="card auth-card">
        <BrandMark size={40} wordmark />
        <div>
          <h1>Connect {client.name}</h1>
          <p className="muted" style={{ marginTop: 4 }}>Signed in as {session.email}. Choose the KQA permissions this app needs.</p>
        </div>
        <p>The protocol connection uses the standard <code>host</code> scope. KQA applies the permissions below to every tool call. The read-only setup and aggregate analysis permissions are selected by default; respondent details, changes, email actions, and deletion require your explicit choice.</p>
        <p className="muted">The connection is saved in Settings as a key. You can change its permissions or revoke it there.</p>
        <form action={decide} className="stack">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={challenge} />
          <fieldset className="stack" style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
            <legend>Permissions</legend>
            {availableCapabilities.map((capability, index) => {
              const info = MCP_CAPABILITY_INFO[capability];
              return (
                <label key={capability} style={{ display: "grid", gridTemplateColumns: "20px 1fr", alignItems: "start", gap: 8 }}>
                  <input type="checkbox" name="capabilities" value={capability} defaultChecked={DEFAULT_MCP_CAPABILITIES.includes(capability)} required={index === 0} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                  <span><strong>{info.label}</strong><br /><span className="muted">{info.description}</span></span>
                </label>
              );
            })}
          </fieldset>
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
  const capabilities = parseMcpCapabilities(formData.getAll("capabilities"));
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
  if (String(formData.get("decision")) !== "allow" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    redirect(authorizeError(redirectUri, origin, "access_denied", state));
  }
  if (!capabilities || !canGrantMcpCapabilitiesForRole(session.role, capabilities)) redirect(authorizeError(redirectUri, origin, "invalid_scope", state));
  const code = await issueCode({ clientId, redirectUri, challenge, email: session.email, tenantId: session.tenantId, userId: session.userId, capabilities });
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("iss", origin);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}
