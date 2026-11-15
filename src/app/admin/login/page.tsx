import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { AuthModalRoute } from "@/components/AuthModalRoute";
import { LandingSurface } from "@/components/LandingSurface";
import { adminSession } from "@/lib/http";

export const metadata = { title: "Host sign in" };
export const dynamic = "force-dynamic";

function safeNext(next?: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/admin";
  if (next.startsWith("/admin") || next.startsWith("/oauth/authorize?")) return next;
  return "/admin";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safe = safeNext(next);
  if (await adminSession()) redirect(safe);
  return (
    <>
      <div className="auth-route-background" aria-hidden="true" inert><LandingSurface /></div>
      <AuthModalRoute title="Host sign in" variant="login"><LoginForm next={safe} /></AuthModalRoute>
    </>
  );
}
