import { frameContentSecurityPolicy, injectBridge } from "./format/bridge";

/** A questionnaire document, with the bridge injected and every browser-side restriction applied. */
export function frameResponse(html: string, assetOrigin?: string): Response {
  return new Response(injectBridge(html), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": frameContentSecurityPolicy(assetOrigin),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  });
}

export function framePlaceholder(message: string, status = 404): Response {
  const html = `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:2rem;color:#37465a">${message.replace(/[<&]/g, "")}</body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
