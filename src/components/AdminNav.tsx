"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, BrandMark, Icon } from "./ui";

const LINKS = [
  { href: "/admin", label: "Interview", match: (p: string) => p === "/admin" || p.startsWith("/admin/interviews") || p === "/admin/new" },
  { href: "/admin/check", label: "Checking", match: (p: string) => p.startsWith("/admin/check") },
  { href: "/admin/docs", label: "Guide", match: (p: string) => p.startsWith("/admin/docs") },
  { href: "/admin/settings", label: "Settings", match: (p: string) => p.startsWith("/admin/settings") },
];

export function AdminNav({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>("[aria-current='page']")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [path]);
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/admin" className="brand" aria-label="KQA home">
            <BrandMark />
            <span>KQA <small>Host</small></span>
          </Link>
          <nav className="nav" aria-label="Main" ref={navRef}>
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
    </>
  );
}
