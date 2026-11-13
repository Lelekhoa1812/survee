import Link from "next/link";
import { BrandMark } from "@/components/ui";

export default function Home() {
  return (
    <main className="center-page">
      <div className="hero">
        <BrandMark size={44} />
        <h1>Open the link your host sent you</h1>
        <p className="muted">Each interview has its own private link. Paste it into your browser to continue where you left off. Your answers save as you go.</p>
        <Link href="/admin" className="btn ghost sm">Host sign in</Link>
      </div>
    </main>
  );
}
