"use client";

import { useRouter } from "next/navigation";
import { Modal } from "./ui";

export function AuthModalRoute({
  title,
  variant,
  children,
}: {
  title: string;
  variant: "login" | "signup";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const close = () => router.replace("/");

  return (
    <Modal title={title} onClose={close} className={`auth-route-modal auth-route-modal--${variant}`} scrimClassName="auth-route-scrim">
      <button className="auth-route-close" type="button" aria-label={`Close ${title}`} onClick={close}>
        <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
      </button>
      {children}
    </Modal>
  );
}
