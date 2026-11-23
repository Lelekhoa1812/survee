export type DeliveryKind = "delivered" | "bounced" | "unknown" | "ignore";

function bare(id: string): string {
  return id.replace(/[<>]/g, "").trim().toLowerCase();
}

/**
 * Classify one RFC822 source that a search for our message id returned.
 * The copy we sent (its own Message-ID is the id we stored) is not a delivery report.
 */
export function classifyDeliverySource(source: string, trackedId: string): DeliveryKind {
  const tracked = bare(trackedId);
  if (!tracked) return "unknown";
  const own = source.match(/^message-id:\s*<([^>\r\n]+)>/im);
  if (own && bare(own[1]) === tracked) return "ignore";
  const action = source.match(/^action:\s*(failed|delivered|relayed|expanded|delayed)\b/im);
  if (action) {
    const value = action[1].toLowerCase();
    if (value === "failed") return "bounced";
    // RFC 3464 distinguishes final delivery from relaying/expansion. Those
    // actions only confirm onward handling, not arrival at the recipient.
    if (value !== "delivered") return "unknown";
    return "delivered";
  }
  if (/delivery status notification \(failure\)|undelivered mail|mail delivery failed|delivery incomplete|address not found|user unknown/i.test(source)) return "bounced";
  if (/delivery status notification \(success\)|\baction:\s*delivered\b|successfully delivered/i.test(source)) return "delivered";
  return "unknown";
}

/** The only IMAP search this app builds. It names one stored message id and nothing else. */
export function deliverySearchQuery(messageId: string): { or: Array<Record<string, unknown>> } {
  const id = bare(messageId);
  return {
    or: [
      { header: { "In-Reply-To": id } },
      { header: { References: id } },
      { body: id },
    ],
  };
}

export function looksLikeMessageId(value: string): boolean {
  return /^<[A-Za-z0-9][A-Za-z0-9._@-]{8,200}>$/.test(value);
}
