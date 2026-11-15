import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata = { title: "Choose a new password", referrer: "no-referrer" as const };

export default function ResetPasswordPage() {
  return <main className="center-page"><ResetPasswordForm /></main>;
}
