import { VerifySignupForm } from "@/components/VerifySignupForm";

export const metadata = { title: "Verify your email", referrer: "no-referrer" as const };

export default function VerifyPage() {
  return <main className="center-page"><VerifySignupForm /></main>;
}
