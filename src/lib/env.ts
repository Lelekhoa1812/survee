/** Environment access with clear failure messages. Secrets are never logged. */
const isProd = process.env.NODE_ENV === "production";
/** Development fallbacks are for a developer's own machine only: never in production and never on Vercel, whatever NODE_ENV says. */
const allowDevDefaults = !isProd && !process.env.VERCEL;

/** The migrated legacy workspace and the only tenant bound to KQA_MCP_TOKEN. */
export const AXION_TENANT_ID = "axion";
export const AXION_OWNER_EMAIL = "admin@axiob.local";

export function mongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env (local) or to the Vercel project environment variables.");
  return uri;
}

export function dbName(): string {
  return process.env.MONGODB_DB || "kqa";
}

export interface AdminConfig {
  email: string;
  password: string;
  secret: string;
}

/** Signing key for persistent account sessions. Independent from the one-time legacy bootstrap credential. */
export function sessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET || (allowDevDefaults ? "kqa-dev-only-secret-change-me" : "");
  if (!secret || (!allowDevDefaults && secret.length < 16)) return null;
  return secret;
}

/**
 * The single host login for now. In production the three values must be set as environment variables; the
 * fallbacks exist only so `npm run dev` works out of the box on a developer's machine.
 */
/**
 * Origin written into invite emails. Locked: this is the only host those links may use.
 * Unset is a refusal to send, not a guess from the browser address.
 */
export function publicBaseUrl(): { ok: true; origin: string } | { ok: false; error: string } {
  const raw = process.env.KQA_PUBLIC_URL?.trim() ?? "";
  if (!raw) return { ok: false, error: "Set KQA_PUBLIC_URL to the public address of this app before sending an invite." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "KQA_PUBLIC_URL must be a full http or https address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "KQA_PUBLIC_URL must start with https:// or http://." };
  if (url.username || url.password) return { ok: false, error: "KQA_PUBLIC_URL must not include a username or password." };
  return { ok: true, origin: url.origin };
}

/** SMTP send. Read only when a send is attempted, so a missing password does not take down the rest of the app. */
export function smtpSettings(): { ok: true; host: string; port: 587; user: string; password: string } | { ok: false; error: string } {
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER?.trim() ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  if (!host || !user || !password) return { ok: false, error: "Email is not set up on this server yet." };
  if (port !== 587) return { ok: false, error: "Email sending uses port 587 (STARTTLS)." };
  return { ok: true, host, port: 587, user, password };
}

/** IMAP bounce check. Same mailbox as SMTP. Read only when a check is requested. */
export function imapSettings(): { ok: true; host: string; port: 993; user: string; password: string } | { ok: false; error: string } {
  const host = process.env.IMAP_HOST?.trim() ?? "";
  const port = Number(process.env.IMAP_PORT ?? "993");
  const user = process.env.SMTP_USER?.trim() ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  if (!host || !user || !password) return { ok: false, error: "Delivery check is not set up on this server yet." };
  if (port !== 993) return { ok: false, error: "Delivery check uses IMAP port 993." };
  return { ok: true, host, port: 993, user, password };
}

/** Bearer token for /api/mcp. Null when missing or shorter than 32 characters. Never logged. */
export function mcpToken(): string | null {
  const token = process.env.KQA_MCP_TOKEN ?? "";
  if (token.length < 32) return null;
  return token;
}

export function adminConfig(): AdminConfig | { error: string } {
  const email = process.env.ADMIN_EMAIL || (allowDevDefaults ? AXION_OWNER_EMAIL : "");
  const password = process.env.ADMIN_PASSWORD || (allowDevDefaults ? "12345678" : "");
  const secret = sessionSecret();
  if (!email || !password || !secret) {
    return { error: "Host login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET in the environment." };
  }
  return { email, password, secret };
}
