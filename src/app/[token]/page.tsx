import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { RespondentShell } from "@/components/RespondentShell";
import { looksLikeToken } from "@/lib/tokens";
import { resolveRespondentLocale } from "@/lib/respondent-locale";
import { createRespondentFrameHandle } from "@/lib/frame-handle";

export const metadata = { title: "Interview", robots: { index: false, follow: false } };

export default async function RespondentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!looksLikeToken(token)) notFound();
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = resolveRespondentLocale(requestHeaders.get("accept-language"), cookieStore.get("kqa-respondent-locale")?.value);
  return <RespondentShell token={token} frameHandle={createRespondentFrameHandle(token)} initialLocale={locale} />;
}
