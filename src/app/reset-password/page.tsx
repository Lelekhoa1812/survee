import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata = { title: "Choose a new password", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <main className="center-page"><ResetPasswordForm /></main>;
}
