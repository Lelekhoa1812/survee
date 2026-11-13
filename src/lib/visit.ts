const PREFETCH_UA = /googlebot|google-inspectiontool|googleimageproxy|google-safety|google-read-aloud|bingpreview|skypeuripreview|facebookexternalhit|slackbot|twitterbot|linkedinbot|whatsapp|telegrambot|embedly|discordbot|applebot|outlook|ms-office|microsoft office|safelinks|barracuda|proofpoint|mimecast|urlpreview|linkpreview|yahoo! slurp|yahooseeker/i;

/**
 * GET /api/p/[token] may record "opened their link" only for the respondent app itself.
 * Mail gateways prefetch the link in the invite. They do not send this header, and a prefetch
 * purpose or a known preview agent must not write an open event. Saving an answer is separate
 * and is what moves someone from "Not started" to "In progress".
 */
export function shouldRecordVisit(req: Pick<Request, "headers">): boolean {
  const purpose = [req.headers.get("purpose"), req.headers.get("sec-purpose"), req.headers.get("x-purpose"), req.headers.get("x-moz")].filter(Boolean).join(" ");
  if (/\bprefetch\b|\bpreview\b/i.test(purpose)) return false;
  const ua = req.headers.get("user-agent") ?? "";
  if (PREFETCH_UA.test(ua)) return false;
  if (req.headers.get("x-kqa-client") !== "respondent") return false;
  const mode = req.headers.get("sec-fetch-mode");
  if (mode === "navigate" || mode === "no-cors") return false;
  return true;
}
