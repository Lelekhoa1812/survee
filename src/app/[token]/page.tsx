import { notFound } from "next/navigation";
import { RespondentShell } from "@/components/RespondentShell";
import { looksLikeToken } from "@/lib/tokens";

export const metadata = { title: "Interview", robots: { index: false, follow: false } };

export default async function RespondentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!looksLikeToken(token)) notFound();
  return <RespondentShell token={token} />;
}
