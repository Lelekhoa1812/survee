/** Environment access with clear failure messages. Secrets are never logged. */
const isProd = process.env.NODE_ENV === "production";
/** Development fallbacks are for a developer's own machine only: never in production and never on Vercel, whatever NODE_ENV says. */
const allowDevDefaults = !isProd && !process.env.VERCEL;

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

/**
 * The single host login for now. In production the three values must be set as environment variables; the
 * fallbacks exist only so `npm run dev` works out of the box on a developer's machine.
 */
export function adminConfig(): AdminConfig | { error: string } {
  const email = process.env.ADMIN_EMAIL || (allowDevDefaults ? "admin@axion.local" : "");
  const password = process.env.ADMIN_PASSWORD || (allowDevDefaults ? "12345678" : "");
  const secret = process.env.SESSION_SECRET || (allowDevDefaults ? "kqa-dev-only-secret-change-me" : "");
  if (!email || !password || !secret || (!allowDevDefaults && secret.length < 16)) {
    return { error: "Host login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET in the environment." };
  }
  return { email, password, secret };
}
