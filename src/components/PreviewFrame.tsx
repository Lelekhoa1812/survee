"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AnswerMap, Question } from "@/lib/format/schema";

/**
 * Shows a stored questionnaire in the same sandboxed frame respondents use, for the host to preview it or to read
 * one person's answers in the original layout. Nothing typed here is saved: the frame is told it is a preview.
 */
export function PreviewFrame({ src, html, questions, answers = {}, locked = false, name, width, height = 640, title = "Questionnaire preview" }: { src?: string; html?: string; questions: Question[]; answers?: AnswerMap; locked?: boolean; name?: string; width?: number; height?: number; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const frameName = `kqa-preview-${useId().replace(/:/g, "")}`;
  const [ready, setReady] = useState(false);
  const latest = useRef({ questions, answers, locked, name });
  latest.current = { questions, answers, locked, name };

  useEffect(() => {
    setReady(false);
    if (html !== undefined) formRef.current?.submit();
    function onMessage(ev: MessageEvent) {
      if (ev.source !== ref.current?.contentWindow || ev.origin !== "null") return;
      const m = ev.data;
      if (!m || m.kqa !== 1) return;
      if (m.type === "open" && typeof m.url === "string" && /^(https?:|mailto:|tel:)/i.test(m.url)) {
        window.open(m.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (m.type !== "hello") return;
      const l = latest.current;
      ref.current?.contentWindow?.postMessage({ kqa: 1, type: "init", questions: l.questions, answers: l.answers, participant: l.name ? { name: l.name } : null, locked: l.locked, probe: false, preview: true }, "*");
      setReady(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [src, html, frameName]);

  useEffect(() => {
    if (!ready) return;
    ref.current?.contentWindow?.postMessage({ kqa: 1, type: "answers", answers }, "*");
    ref.current?.contentWindow?.postMessage({ kqa: 1, type: "lock", locked }, "*");
  }, [answers, locked, ready]);

  return (
    <>
      {html !== undefined && (
        <form ref={formRef} action="/api/admin/frame" method="post" target={frameName} hidden>
          <textarea name="html" value={html} readOnly />
        </form>
      )}
      <iframe
        ref={ref}
        name={frameName}
        src={html === undefined ? src : undefined}
        title={title}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        style={{ display: "block", width: width ? `${width}px` : "100%", maxWidth: "100%", height, border: 0, margin: "0 auto", background: "var(--bg)" }}
      />
    </>
  );
}
