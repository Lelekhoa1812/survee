/** One @, a dotted domain, no spaces or display-name wrapping left on the stored value. */
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export type ParsedEmail = { ok: true; email: string | null } | { ok: false; error: string };

/** Empty is valid and means "no address". Anything else must be one mailbox, not the raw paste line. */
export function parseEmail(input: string): ParsedEmail {
  const raw = input.trim();
  if (!raw) return { ok: true, email: null };
  const angle = raw.match(/^[^<>]*<([^<>]+)>\s*$/);
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase();
  if (candidate.length > 254 || candidate.includes(" ") || !EMAIL.test(candidate)) {
    return { ok: false, error: "That does not look like an email address." };
  }
  return { ok: true, email: candidate };
}

export interface PersonDraft {
  name: string;
  email?: string;
  note?: string;
}

/** Accepts "Ada", "Ada, ada@example.com", or "Ada <ada@example.com>". Stores the parsed address only. */
export function parsePersonLine(line: string): { ok: true; person: PersonDraft } | { ok: false; error: string; name: string; emailRaw: string } | { ok: true; person: null } {
  const trimmed = line.trim();
  if (!trimmed) return { ok: true, person: null };
  let name = trimmed;
  let emailRaw: string | undefined;
  const angle = trimmed.match(/^(.*)<([^<>]+)>\s*$/);
  if (angle) {
    name = angle[1].replace(/^["']|["']$/g, "").trim().replace(/,\s*$/, "");
    emailRaw = angle[2].trim();
    if (!name) name = emailRaw.split("@")[0] ?? "";
  } else if (trimmed.includes(",")) {
    const parts = trimmed.split(",");
    const last = parts[parts.length - 1]?.trim() ?? "";
    if (last.includes("@")) {
      emailRaw = last;
      name = parts.slice(0, -1).join(",").trim();
    }
  }
  if (!name) return { ok: false, error: "Each person needs a name.", name: "", emailRaw: emailRaw ?? "" };
  if (name.length > 120) return { ok: false, error: "That name is too long.", name, emailRaw: emailRaw ?? "" };
  if (emailRaw === undefined) return { ok: true, person: { name } };
  const email = parseEmail(emailRaw);
  if (!email.ok) return { ok: false, error: email.error, name, emailRaw };
  return { ok: true, person: { name, email: email.email ?? undefined } };
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}
