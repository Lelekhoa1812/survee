import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <main className="center-page"><ForgotPasswordForm /></main>;
}
