import { LandingSurface } from "@/components/LandingSurface";

export const metadata = {
  title: "survee · Interview hosting",
  description: "Host your HTML questionnaire, share private interview links, and review saved responses in one workspace.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function Home() {
  return <LandingSurface />;
}
