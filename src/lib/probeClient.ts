import { probeTimeoutDiagnostic, probeToDiagnostics, type ProbeMessage } from "./diagnostics/probe";
import type { Diagnostic } from "./diagnostics/types";
import type { Question } from "./format/schema";

/**
 * Run a hidden-frame smoke check: set standard controls programmatically and confirm answer round-trip; for custom
 * controls without native bindings, call KQA.set and check for a visible mutation. This does not simulate human input
 * or test routing end to end, submission/locking, accessibility, or usability. Browser only.
 * The file is posted into the frame so it is served with the real headers; nothing is stored.
 */
export function runProbe(html: string, questions: Question[], opts: { timeoutMs?: number } = {}): Promise<Diagnostic[]> {
  return new Promise((resolve) => {
    const name = `kqa-probe-${Math.random().toString(36).slice(2)}`;
    const holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;width:390px;height:800px;overflow:hidden;visibility:hidden;pointer-events:none";
    const frame = document.createElement("iframe");
    frame.name = name;
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.tabIndex = -1;
    frame.style.cssText = "width:390px;height:800px;border:0";
    holder.appendChild(frame);
    document.body.appendChild(holder);

    let finished = false;
    const finish = (d: Diagnostic[]) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      setTimeout(() => holder.remove(), 0);
      resolve(d);
    };
    const timer = setTimeout(() => finish([probeTimeoutDiagnostic()]), opts.timeoutMs ?? 8000);

    function onMessage(ev: MessageEvent) {
      if (ev.source !== frame.contentWindow || ev.origin !== "null") return;
      const m = ev.data;
      if (!m || m.kqa !== 1) return;
      if (m.type === "hello") {
        frame.contentWindow?.postMessage({ kqa: 1, type: "init", questions, answers: {}, participant: { name: "Probe" }, locked: false, probe: true, preview: true }, "*");
      } else if (m.type === "probe-result") {
        finish(probeToDiagnostics(m as ProbeMessage));
      }
    }
    window.addEventListener("message", onMessage);

    const form = document.createElement("form");
    form.method = "post";
    form.action = "/api/admin/frame";
    form.target = name;
    form.style.display = "none";
    const field = document.createElement("textarea");
    field.name = "html";
    field.value = html;
    form.appendChild(field);
    holder.appendChild(form);
    form.submit();
  });
}
