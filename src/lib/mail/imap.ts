import { ImapFlow } from "imapflow";
import { imapSettings } from "../env";
import { classifyDeliverySource, deliverySearchQuery, looksLikeMessageId, type DeliveryKind } from "./dsn";

export type DeliveryStatus = "delivered" | "bounced" | "unknown";

export interface DeliveryCheck {
  status: DeliveryStatus;
  detail?: string;
}

function rank(kind: DeliveryKind): number {
  if (kind === "bounced") return 3;
  if (kind === "delivered") return 2;
  if (kind === "unknown") return 1;
  return 0;
}

export function publicImapFailure(err: unknown, secret?: string): string {
  let raw = err instanceof Error ? err.message : "";
  if (secret && secret.length > 0) raw = raw.split(secret).join("");
  if (/auth|535|534|invalid credentials|authentication/i.test(raw)) return "The mailbox login was rejected. Check the mailbox settings and try again.";
  if (/timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network/i.test(raw)) return "We could not confirm delivery. Try again in a moment.";
  return "We could not confirm delivery. Try again in a moment.";
}

type Fetchable = {
  search(query: unknown, options: { uid: true }): Promise<number[] | false | undefined>;
  fetch(range: number[], query: { source: true; envelope: true }, options: { uid: true }): AsyncIterable<{ source?: Uint8Array | Buffer }>;
};

const OPERATION_TIMEOUT_MS = 8_000;
const CLEANUP_TIMEOUT_MS = 1_000;

function closeClient(client: ImapFlow): void {
  try { client.close(); } catch { /* already closed */ }
}

async function disconnect(client: ImapFlow, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.logout(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // A closed or unhealthy connection may reject during logout.
  } finally {
    if (timer) clearTimeout(timer);
    closeClient(client);
  }
}

async function classifyInbox(client: Fetchable, messageId: string, recipient: string): Promise<DeliveryStatus> {
  const found = await client.search(deliverySearchQuery(messageId), { uid: true });
  const uids = Array.isArray(found) ? found.slice(0, 5) : [];
  if (!uids.length) return "unknown";
  let best: DeliveryKind = "unknown";
  for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
    const source = Buffer.from(msg.source ?? []).toString("utf8");
    const kind = classifyDeliverySource(source, messageId, recipient);
    if (rank(kind) > rank(best)) best = kind;
    if (best === "bounced") break;
  }
  if (best === "bounced" || best === "delivered") return best;
  return "unknown";
}

/** Connect, search only the message ids we stored, disconnect. No other mailbox search is possible. */
export async function checkMessageIds(messageIds: string[], recipients: Map<string, string> = new Map()): Promise<Map<string, DeliveryCheck>> {
  const ids = [...new Set(messageIds.filter(looksLikeMessageId))].slice(0, 5);
  const out = new Map<string, DeliveryCheck>();
  for (const id of messageIds) out.set(id, { status: "unknown" });
  if (!ids.length) return out;
  const cfg = imapSettings();
  if (!cfg.ok) {
    for (const id of ids) out.set(id, { status: "unknown", detail: cfg.error });
    return out;
  }
  const client = new ImapFlow({
    host: cfg.host,
    port: 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 8_000,
  });
  let lock: { release: () => void } | undefined;
  const work = async () => {
    await client.connect();
    lock = await client.getMailboxLock("INBOX");
    for (const id of ids) {
      try {
        const status = await classifyInbox(client as Fetchable, id, recipients.get(id) ?? "");
        out.set(id, { status, detail: status === "unknown" ? "Not confirmed yet." : undefined });
      } catch (err) {
        out.set(id, { status: "unknown", detail: publicImapFailure(err, cfg.password) });
      }
    }
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      work(),
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          closeClient(client);
          reject(new Error("timeout"));
        }, OPERATION_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    const detail = publicImapFailure(err, cfg.password);
    for (const id of ids) {
      if (!out.get(id)?.detail) out.set(id, { status: "unknown", detail });
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    try { lock?.release(); } catch { /* already released */ }
    // close() is called by the deadline handler. Otherwise allow logout a short,
    // bounded window; disconnect closes the socket whether logout succeeds or hangs.
    if (!timedOut) await disconnect(client, CLEANUP_TIMEOUT_MS);
  }
  return out;
}
