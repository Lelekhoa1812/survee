import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { adminSession } from "@/lib/http";

export const metadata = { title: "Host sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await adminSession()) redirect("/admin");
  const { next } = await searchParams;
  const safe = next && next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
  return (
    <main className="center-page">
      <LoginForm next={safe} />
    </main>
  );
}
