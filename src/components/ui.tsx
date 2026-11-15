"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

// ------------------------------------------------------------------------------------------------ icons
const PATHS: Record<string, ReactNode> = {
  check: <path d="M4 12.5l5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: (<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></>),
  upload: (<><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>),
  download: (<><path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5" /><path d="M4 19h16" /></>),
  file: (<><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>),
  alert: (<><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>),
  chevron: <path d="M9 6l6 6-6 6" />,
  arrowLeft: <path d="M15 6l-6 6 6 6" />,
  link: (<><path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1" /></>),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 20c1.2-3.6 4.2-5.5 8-5.5s6.8 1.9 8 5.5" /></>),
  users: (<><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5" /><path d="M16 5.2a3.5 3.5 0 010 6.6M18.5 14.8c1.8.8 2.9 2.4 3.4 4.7" /></>),
  lock: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>),
  refresh: (<><path d="M20 11a8 8 0 00-14.5-4M4 4v4h4" /><path d="M4 13a8 8 0 0014.5 4M20 20v-4h-4" /></>),
  trash: (<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></>),
  external: (<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" /></>),
  logout: (<><path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>),
  edit: (<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  shield: <path d="M12 3l8 3v5.5c0 4.5-3.2 8.2-8 9.5-4.8-1.3-8-5-8-9.5V6z" />,
  inbox: (<><path d="M3 13l2.5-8h13L21 13v5a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
};

export function Icon({ name, size = 18, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} focusable="false">
      {PATHS[name] ?? null}
    </svg>
  );
}

export function BrandMark({ size = 28, wordmark = false }: { size?: number; wordmark?: boolean }) {
  const clipId = `kqa-leg-${useId().replace(/:/g, "")}`;
  const mark = (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}><rect x="10.2" y="0" width="22" height="32" /></clipPath>
      </defs>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <g fill="none" strokeWidth="3.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.15 15.25 22.15 7.75" stroke="var(--mark-ink)" />
        <path d="M6.2 11.4 22.85 24.35" stroke="var(--mark-leg)" clipPath={`url(#${clipId})`} />
        <path d="M11.15 7.35v17.3" stroke="var(--mark-ink)" />
      </g>
    </svg>
  );
  if (!wordmark) return mark;
  return (
    <span className="brand-lockup" style={{ fontSize: Math.round(size * 0.56), gap: Math.round(size * 0.28) }}>
      {mark}
      <span className="brand-word">KQA</span>
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

// ------------------------------------------------------------------------------------------------ toasts
interface ToastItem { id: number; text: string; kind: "ok" | "err" }
const ToastCtx = createContext<(text: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "err" ? 6000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>
            <Icon name={t.kind === "err" ? "alert" : "check"} size={16} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------------------------------------ clipboard
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = "Copy", done = "Copied", className = "btn sm", icon = true, getText, ariaLabel, disabled = false }: { text?: string; label?: string; done?: string; className?: string; icon?: boolean; getText?: () => string; ariaLabel?: string; disabled?: boolean }) {
  const [ok, setOk] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(false), 1800);
    return () => clearTimeout(t);
  }, [ok]);
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel || undefined}
      disabled={disabled}
      onClick={async () => {
        const good = await copyText(getText ? getText() : (text ?? ""));
        if (good) setOk(true);
        else toast("Copy was blocked by the browser. Select the text and copy it by hand.", "err");
      }}
    >
      {icon && <Icon name={ok ? "check" : "copy"} size={15} />}
      {ok ? done : label}
    </button>
  );
}

// ------------------------------------------------------------------------------------------------ modal
export function Modal({ title, children, onClose, actions, className, style }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (!dialog) return;
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, object, embed, [contenteditable]:not([contenteditable="false"]), [tabindex]',
    )).filter((element) => {
      if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const computed = window.getComputedStyle(element);
      return computed.display !== "none" && computed.visibility !== "hidden";
    });
    const focusables = getFocusable();
    const preferred = dialog.querySelector<HTMLElement>("[autofocus]");
    (preferred && focusables.includes(preferred) ? preferred : focusables[0] ?? dialog).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === "Tab") {
        const current = ref.current;
        if (!current) return;
        const focusable = getFocusable();
        if (!focusable.length) {
          e.preventDefault();
          current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!current.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${className ? ` ${className}` : ""}`} style={style} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ small helpers
export function Badge({ kind = "", children, plain }: { kind?: "ok" | "warn" | "err" | "info" | ""; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${kind} ${plain ? "plain" : ""}`}>{children}</span>;
}

export async function api<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const headers = { ...(init?.headers ?? {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) };
    const res = await fetch(url, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: Object.keys(headers).length ? headers : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Could not reach the server. Check your connection and try again." } as T & { error?: string } };
  }
}
