export type DeliveryKind = "delivered" | "bounced" | "unknown" | "ignore";

type HeaderMap = Map<string, string[]>;

function bare(id: string): string {
  return id.replace(/[<>]/g, "").trim().toLowerCase();
}

function unfoldLines(source: string): string[] {
  const unfolded: string[] = [];
  for (const line of source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else unfolded.push(line);
  }
  return unfolded;
}

function parseHeaders(source: string): HeaderMap {
  const headers: HeaderMap = new Map();
  for (const line of unfoldLines(source)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(name, [...(headers.get(name) ?? []), value]);
  }
  return headers;
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const values = headers.get(name);
  return values?.length === 1 ? values[0] : undefined;
}

function splitHeaderBody(source: string): { headers: HeaderMap; body: string } | null {
  const match = /\r?\n\r?\n/.exec(source);
  if (!match) return null;
  return { headers: parseHeaders(source.slice(0, match.index)), body: source.slice(match.index + match[0].length) };
}

function messageIdIn(value: string, tracked: string): boolean {
  return [...value.matchAll(/<([^<>\s]+)>/g)].some((match) => bare(match[1]) === tracked);
}

function boundaryFrom(contentType: string): string | null {
  if (!/^multipart\/report\s*;/i.test(contentType) || !/\breport-type\s*=\s*"?delivery-status"?(?:\s*;|$)/i.test(contentType)) return null;
  const match = contentType.match(/(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  return (match?.[1] ?? match?.[2]) || null;
}

type MimePart = { headers: HeaderMap; body: string };

function mimeParts(source: string, boundary: string): MimePart[] | null {
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const delimiter = new RegExp(`(?:^|\\r?\\n)--${escaped}(?:--)?[ \\t]*(?:\\r?\\n|$)`, "g");
  const starts: { start: number; tokenStart: number; closing: boolean }[] = [];
  for (const match of source.matchAll(delimiter)) {
    const token = match[0].replace(/^\r?\n/, "").trim();
    starts.push({
      start: match.index! + match[0].length,
      tokenStart: match.index! + (match[0].startsWith("\r\n") ? 2 : match[0].startsWith("\n") ? 1 : 0),
      closing: token.startsWith(`--${boundary}--`),
    });
  }
  const closers = starts.filter((part) => part.closing);
  if (closers.length !== 1 || starts.at(-1) !== closers[0]) return null;
  const parts: MimePart[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    if (start.closing) break;
    const end = starts[i + 1]?.tokenStart ?? source.length;
    const part = splitHeaderBody(source.slice(start.start, end));
    if (part) parts.push(part);
  }
  return parts;
}

function supportedTransferEncoding(part: MimePart): boolean {
  const values = part.headers.get("content-transfer-encoding") ?? [];
  return values.length <= 1 && ["7bit", "8bit", "binary"].includes((values[0] ?? "7bit").toLowerCase());
}

function deliveryStatusPart(parts: MimePart[]): MimePart | null {
  const matches = parts.filter((part) => /^message\/delivery-status(?:\s*;|$)/i.test(headerValue(part.headers, "content-type") ?? ""));
  return matches.length === 1 && supportedTransferEncoding(matches[0]) ? matches[0] : null;
}

function attachedOriginalMessageId(parts: MimePart[]): string | null {
  const matches = parts.filter((part) => /^message\/rfc822(?:\s*;|$)/i.test(headerValue(part.headers, "content-type") ?? ""));
  if (matches.length !== 1 || !supportedTransferEncoding(matches[0])) return null;
  const headerEnd = /\r?\n\r?\n/.exec(matches[0].body)?.index ?? matches[0].body.length;
  return headerValue(parseHeaders(matches[0].body.slice(0, headerEnd)), "message-id") ?? null;
}

function decodeXText(value: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "+") {
      if (char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126 || char === "=") return null;
      bytes.push(char.charCodeAt(0));
      continue;
    }
    const code = value.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(code)) return null;
    bytes.push(Number.parseInt(code, 16));
    i += 2;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function parseStatusBlocks(source: string): HeaderMap[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of unfoldLines(source)) {
    if (!line.trim()) {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.map(parseHeaders);
}

function recipientAddresses(headers: HeaderMap): { final: string; original?: string } | null {
  const finalRecipient = headerValue(headers, "final-recipient");
  const originalRecipient = headerValue(headers, "original-recipient");
  if (!finalRecipient || (headers.get("final-recipient")?.length ?? 0) !== 1 || (headers.get("original-recipient")?.length ?? 0) > 1) return null;
  const parseRfc822 = (value: string, xtext: boolean): string | null => {
    const separator = value.indexOf(";");
    if (separator < 0 || value.slice(0, separator).trim().toLowerCase() !== "rfc822") return null;
    const address = value.slice(separator + 1).trim();
    return xtext ? decodeXText(address)?.toLowerCase() ?? null : address.toLowerCase() || null;
  };
  const final = parseRfc822(finalRecipient, false);
  if (!final) return null;
  if (!originalRecipient) return { final };
  // ORCPT preserves the address we submitted even if delivery was forwarded
  // to a different final mailbox.
  const original = parseRfc822(originalRecipient, true);
  return original ? { final, original } : null;
}

/**
 * Classify only a structured RFC 3464 report. Search hits, quoted prose, and
 * malformed or multi-recipient reports stay unknown unless the exact envelope
 * id, invite recipient, and one recipient action can all be correlated.
 */
export function classifyDeliverySource(source: string, trackedId: string, trackedRecipient: string): DeliveryKind {
  const tracked = bare(trackedId);
  const recipient = trackedRecipient.trim().toLowerCase();
  if (!tracked || !recipient) return "unknown";
  const headerEnd = /\r?\n\r?\n/.exec(source)?.index ?? source.length;
  const own = headerValue(parseHeaders(source.slice(0, headerEnd)), "message-id");
  if (own && messageIdIn(own, tracked)) return "ignore";
  const top = splitHeaderBody(source);
  if (!top) return "unknown";
  const contentType = headerValue(top.headers, "content-type") ?? "";
  const boundary = boundaryFrom(contentType);
  if (!boundary) return "unknown";
  const parts = mimeParts(top.body, boundary);
  if (!parts) return "unknown";
  const part = deliveryStatusPart(parts);
  if (!part) return "unknown";
  const blocks = parseStatusBlocks(part.body);
  if (blocks.length !== 2) return "unknown"; // one per-message and exactly one per-recipient block
  if ((blocks[0].get("original-envelope-id")?.length ?? 0) > 1) return "unknown";
  const envelopeId = headerValue(blocks[0], "original-envelope-id");
  const references = [
    ...(top.headers.get("in-reply-to") ?? []),
    ...(top.headers.get("references") ?? []),
  ];
  const referenced = references.some((value) => messageIdIn(value, tracked));
  const attachedId = attachedOriginalMessageId(parts);
  if (envelopeId ? bare(envelopeId) !== tracked : !referenced && !(attachedId && messageIdIn(attachedId, tracked))) return "unknown";
  const reportingMta = headerValue(blocks[0], "reporting-mta");
  if ((blocks[0].get("reporting-mta")?.length ?? 0) !== 1 || !reportingMta || !/^(?:dns|x400);\s*\S/i.test(reportingMta)) return "unknown";
  const recipients = recipientAddresses(blocks[1]);
  if (!recipients || (recipients.original ?? recipients.final) !== recipient) return "unknown";
  const action = headerValue(blocks[1], "action")?.toLowerCase();
  const status = headerValue(blocks[1], "status");
  if ((blocks[1].get("status")?.length ?? 0) !== 1) return "unknown";
  const statusClass = status?.match(/^([245])\.\d{1,3}\.\d{1,3}(?:[ \t]|$)/)?.[1];
  if (action === "failed" && statusClass === "5") return "bounced";
  if (action === "delivered" && statusClass === "2") return "delivered";
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
