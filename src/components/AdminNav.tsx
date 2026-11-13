"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, BrandMark, Icon } from "./ui";

const LINKS = [
  { href: "/admin", label: "Interviews", match: (p: string) => p === "/admin" || p.startsWith("/admin/interviews") || p === "/admin/new" },
  { href: "/admin/check", label: "Check a file", match: (p: string) => p.startsWith("/admin/check") },
  { href: "/admin/docs", label: "Format guide", match: (p: string) => p.startsWith("/admin/docs") },
];

export function AdminNav({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link href="/admin" className="brand" aria-label="KQA home">
          <BrandMark />
          <span>KQA <small>Host</small></span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>{l.label}</Link>
          ))}
        </nav>
        <div className="right row">
          <span className="muted email" style={{ fontSize: 13 }} title={email}>{email}</span>
          <button
            className="btn ghost sm"
            aria-label="Sign out"
            onClick={async () => {
              await api("/api/admin/logout", { method: "POST", body: {} });
              router.replace("/admin/login");
              router.refresh();
            }}
          >
            <Icon name="logout" size={15} /> <span className="label">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
