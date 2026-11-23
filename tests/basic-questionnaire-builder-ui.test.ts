// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";
import { BasicQuestionnaireBuilder } from "../src/components/BasicQuestionnaireBuilder";

let host: HTMLDivElement;
let root: Root;
const useHtml = vi.fn();

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); });
}

async function change(selector: string, value: string) {
  const input = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!input) throw new Error(`Input not found: ${selector}`);
  await act(async () => {
    if (input instanceof HTMLInputElement && input.type === "checkbox") (input as HTMLInputElement).checked = value === "true";
    else Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("basic questionnaire builder UI", () => {
  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    useHtml.mockReset();
  });

  it("creates a portable checked-file candidate from the common native controls", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-title", "Customer feedback");
    await change("#builder-label-0", "How was your visit?");
    await click("Use questionnaire");
    expect(useHtml).toHaveBeenCalledOnce();
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain("Customer feedback");
    expect(html).toContain('"id": "question-1"');
    expect(html).toContain('data-kqa="question-1"');
  });

  it("supports ordered question creation and removal", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    expect(host.textContent).toContain("Question 2");
    const removeButtons = Array.from(host.querySelectorAll("button")).filter((item) => item.textContent?.trim() === "Remove");
    await act(async () => { removeButtons[1].click(); });
    expect(host.textContent).not.toContain("Question 2");
  });

  it("creates a full-order ranking with the KQA option count visible", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "rank");
    expect(host.textContent).toContain("Ranked options");
    expect(host.textContent).toContain("2–8 options");
    for (let i = 0; i < 6; i += 1) await click("Add choice");
    expect(Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes("Add choice"))?.disabled).toBe(true);
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"type": "rank"');
    expect(html).toContain('"value": "option-8"');
    expect(html).toContain('<ol class="rank" data-kqa="question-1"');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("adds a section, assigns the current question, and emits a checked manifest", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add section");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"id": "section-1"');
    expect(html).toContain('"section": "section-1"');
    expect(html).toContain('<div data-kqa-question-list="section-1">');
    const report = checkHtml(html, { fileName: "generated.html" });
    expect(report.ok).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });
});
