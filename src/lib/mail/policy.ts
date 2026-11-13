import { publicBaseUrl } from "../env";

/**
 * Locked send policy. See docs/plans/2026-11-13-locked-decisions.md.
 *
 * 1. Invite links always use KQA_PUBLIC_URL. Unset refuses the send. The People screen copy-link
 *    still uses the address the host is looking at; that choice lives in the components, not here.
 * 2. A send counts as current only when `to` and `token` still match the person (see mail/state.ts).
 * 3. One SMTP conversation per call. sendInvite accepts a single personId and has no batch entry.
 * 4. A bad MCP token is rejected in mcp/auth.ts and does not import the database.
 */
export const INVITE_LINK_POLICY = "public_url_only" as const;
export const SENT_MATCH_POLICY = "address_and_token" as const;
export const SEND_BATCH_POLICY = "one_person" as const;

export function inviteLink(token: string): { ok: true; link: string; origin: string } | { ok: false; error: string } {
  const base = publicBaseUrl();
  if (!base.ok) return base;
  return { ok: true, origin: base.origin, link: `${base.origin}/${token}` };
}
