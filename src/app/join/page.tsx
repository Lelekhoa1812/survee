import Link from "next/link";
import { JoinWorkspacePanel } from "@/components/JoinWorkspacePanel";
import { adminSession } from "@/lib/http";
import { getWorkspaceInvitation } from "@/lib/repo/workspaces";

export const metadata = { title: "Join a survee workspace", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function JoinWorkspacePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token?.slice(0, 128) ?? "";
  let invitation: Awaited<ReturnType<typeof getWorkspaceInvitation>> = null;
  let invitationLookupFailed = false;
  try {
    invitation = await getWorkspaceInvitation(token);
  } catch {
    invitationLookupFailed = true;
  }
  const session = await adminSession();
  return (
    <main className="page narrow" style={{ paddingTop: "8vh" }}>
      {!invitation ? (
        invitationLookupFailed
          ? <section className="card auth-card"><h1>We couldn’t check this invitation</h1><p className="muted">The workspace service is temporarily unavailable. Try again in a moment.</p><Link className="btn" href={`/join${token ? `?token=${encodeURIComponent(token)}` : ""}`}>Try again</Link></section>
          : <section className="card auth-card"><h1>Invitation unavailable</h1><p className="muted">This workspace invitation is invalid, expired, revoked, or already used.</p><Link className="btn" href="/admin/login">Sign in</Link></section>
      ) : (
        <JoinWorkspacePanel
          token={token}
          tenantName={invitation.tenantName}
          email={invitation.email}
          role={invitation.role}
          expiresAt={invitation.expiresAt}
          signedInEmail={session?.email ?? null}
        />
      )}
    </main>
  );
}
