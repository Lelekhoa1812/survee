import { SignupForm } from "@/components/SignupForm";
import { AuthModalRoute } from "@/components/AuthModalRoute";
import { LandingSurface } from "@/components/LandingSurface";

export const metadata = { title: "Create a workspace" };

export default function SignupPage() {
  return (
    <>
      <div className="auth-route-background" aria-hidden="true" inert><LandingSurface /></div>
      <AuthModalRoute title="Create a workspace" variant="signup"><SignupForm /></AuthModalRoute>
    </>
  );
}
