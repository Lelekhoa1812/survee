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
        <span aria-hidden="true">×</span>
      </button>
      {children}
    </Modal>
  );
}
