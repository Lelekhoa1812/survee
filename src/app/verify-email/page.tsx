import { VerifyEmailChangeForm } from "@/components/VerifyEmailChangeForm";

export const metadata = { title: "Verify account email", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default function VerifyEmailPage() {
  return <main className="center-page"><VerifyEmailChangeForm /></main>;
}
