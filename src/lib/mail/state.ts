import type { MailDelivery, MailStatus } from "../repo/types";

/** Locked: current "sent" is the latest row for this exact address and this exact token. */
export interface MailRecord {
  id: string;
  to: string;
  token: string;
  status: MailStatus;
  error?: string;
  messageId?: string;
  sentAt: string;
  delivery?: MailDelivery;
  deliveryCheckedAt?: string;
  deliveryDetail?: string;
}

export interface MailView {
  state: "unsent" | "pending" | "sent" | "failed";
  sentAt?: string;
  error?: string;
  messageId?: string;
  delivery: MailDelivery;
  deliveryCheckedAt?: string;
  deliveryDetail?: string;
}

export function currentMail(person: { email?: string | null; token: string }, rows: MailRecord[]): MailView {
  const email = person.email?.trim().toLowerCase() ?? "";
  const matching = rows
    .filter((row) => row.to === email && row.token === person.token)
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
  const latest = matching[0];
  if (!latest) return { state: "unsent", delivery: "unknown" };
  if (latest.status === "pending") {
    if (latest.delivery === "delivered" || latest.delivery === "bounced") {
      return {
        state: "sent", sentAt: latest.sentAt, messageId: latest.messageId,
        delivery: latest.delivery, deliveryCheckedAt: latest.deliveryCheckedAt, deliveryDetail: latest.deliveryDetail,
      };
    }
    return {
      state: "pending", sentAt: latest.sentAt, messageId: latest.messageId,
      delivery: latest.delivery ?? "unknown", deliveryCheckedAt: latest.deliveryCheckedAt, deliveryDetail: latest.deliveryDetail,
    };
  }
  if (latest.status === "failed") {
    return { state: "failed", sentAt: latest.sentAt, error: latest.error, delivery: "unknown" };
  }
  return {
    state: "sent",
    sentAt: latest.sentAt,
    messageId: latest.messageId,
    delivery: latest.delivery ?? "unknown",
    deliveryCheckedAt: latest.deliveryCheckedAt,
    deliveryDetail: latest.deliveryDetail,
  };
}
