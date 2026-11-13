import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { adminSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await adminSession();
  if (!session) redirect("/admin/login");
  return (
    <>
      <AdminNav email={session.email} />
      {children}
    </>
  );
}
