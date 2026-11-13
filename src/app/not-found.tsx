import Link from "next/link";
import { BrandMark } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="hero">
        <BrandMark size={44} />
        <h1>We could not find that page</h1>
        <p className="muted">Check the link you were given. If you are the host, you can go back to your interviews.</p>
        <Link href="/admin" className="btn ghost sm">Host sign in</Link>
      </div>
    </main>
  );
}
