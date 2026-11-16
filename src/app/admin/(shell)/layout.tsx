import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { adminSession } from "@/lib/http";
import { listAccountWorkspaces } from "@/lib/repo/workspaces";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await adminSession();
  if (!session) redirect("/admin/login");
  const workspaces = await listAccountWorkspaces(session.userId).catch(() => []);
  return (
    <>
      <AdminNav email={session.email} tenantId={session.tenantId} workspaces={workspaces} />
      {children}
    </>
  );
}
