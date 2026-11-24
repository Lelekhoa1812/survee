import { VerifySignupForm } from "@/components/VerifySignupForm";

export const metadata = { title: "Verify your email", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default function VerifyPage() {
  return <main className="center-page"><VerifySignupForm /></main>;
}
