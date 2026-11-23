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
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === label || item.textContent?.includes(label));
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

async function toggle(selector: string) {
  const input = host.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Checkbox not found: ${selector}`);
  await act(async () => { input.click(); });
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

  it("sets language and direction and reorders choices in the generated rank", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-language", "ar");
    await change("#builder-direction", "rtl");
    await change("#builder-type-0", "rank");
    const moveDown = host.querySelector<HTMLButtonElement>('button[aria-label="Move choice 1 down in question 1"]');
    expect(moveDown).toBeTruthy();
    await act(async () => { moveDown!.click(); });
    await click("Use questionnaire");

    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('"options": [\n        {\n          "value": "option-2"');
    expect(html).toContain('<ol class="rank" data-kqa="question-1" aria-labelledby="heading-question-1"><li data-value="option-2">Option 2</li>');
    expect(checkHtml(html, { fileName: "localized-rank.html" }).ok).toBe(true);
  });

  it("reorders repeat record fields and their choice options in the generated HTML", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "repeat");
    await click("Add record field");
    await click("Move record field 2 up in question 1");
    await change('select[aria-label="Record field 1 type"]', "single");
    await click("Move choice 1 down in record field 1 of question 1");
    await click("Use questionnaire");

    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"fields": [\n        {\n          "id": "field-2"');
    expect(html).toContain('"options": [\n            {\n              "value": "option-2"');
    expect(html).toContain('data-kqa-repeat-field="field-2"');
    expect(html).toContain('<input type="radio" data-kqa-repeat-field="field-2" value="option-2">');
    expect(checkHtml(html, { fileName: "repeat-order.html" }).ok).toBe(true);
  });

  it("prevents question moves that invert an earlier-answer routing dependency", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await click("Add question");
    await change("#builder-type-2", "number");
    await click("Add all-match rule group to question 3");
    await change("#builder-route-source-2-all-0", "question-1");

    const safeMove = host.querySelector<HTMLButtonElement>('button[aria-label="Move question 1 down"]');
    expect(safeMove?.disabled).toBe(false);
    await click("Move question 1 down");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Move question 2 down"]')?.disabled).toBe(true);
    await click("Move question 2 up");
    await click("Use questionnaire");

    const html = useHtml.mock.calls[0][0] as string;
    expect(checkHtml(html, { fileName: "routed-order.html" }).ok).toBe(true);
    expect(html).toContain('"question": "question-1"');
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

  it("routes a later question from an earlier single-choice answer", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await click("Add all-match rule group to question 2");
    await change("#builder-route-source-1-all-0", "question-1");
    await change("#builder-id-0", "customer-type");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"question": "customer-type"');
    expect(html).toContain('"operator": "equals"');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("keeps routing attached to a uniquely matching choice label when its stored value changes", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await click("Add all-match rule group to question 2");
    await change("#builder-route-source-1-all-0", "question-1");
    await change('[aria-label="Choice 1 stored value for question 1"]', "new-option-key");
    await click("Use questionnaire");

    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"value": "new-option-key"');
    const report = checkHtml(html, { fileName: "renamed-choice-route.html" });
    expect(report.ok, JSON.stringify(report.diagnostics)).toBe(true);
  });

  it("shows an explicit repair hint when a choice value changes without a unique label match", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await click("Add all-match rule group to question 2");
    await change("#builder-route-source-1-all-0", "question-1");
    await change('[aria-label="Choice 2 displayed label for question 1"]', "Option 1");
    await change('[aria-label="Choice 1 stored value for question 1"]', "new-option-key");

    expect(host.textContent).toContain("This choice was removed or changed. Choose a current value or remove this rule before using the questionnaire.");
    expect(host.textContent).toContain("Missing choice: option-1");
  });

  it("supports multiple earlier-answer rules that must all match", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "single");
    await click("Add question");
    await change("#builder-type-1", "number");
    await click("Add question");
    await click("Add all-match rule group to question 3");
    await change("#builder-route-source-2-all-0", "question-2");
    await click("Add routing rule");
    await change("#builder-route-source-2-all-1", "question-1");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"all": [');
    expect(html).toContain('"question": "question-2"');
    expect(html).toContain('"question": "question-1"');
    expect(checkHtml(html, { fileName: "multiple-rules.html" }).ok).toBe(true);
  });

  it("supports any-match routing across earlier answers", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "single");
    await click("Add question");
    await change("#builder-type-1", "number");
    await click("Add question");
    await click("Add any-match rule group to question 3");
    await change("#builder-route-source-2-any-0", "question-2");
    await click("Add routing rule");
    await change("#builder-route-source-2-any-1", "question-1");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"any": [');
    expect(html).not.toContain('"all": [');
    expect(checkHtml(html, { fileName: "any-match-rules.html" }).ok).toBe(true);
  });

  it("combines all-match and any-match routing groups", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await click("Add question");
    await click("Add all-match rule group to question 3");
    await change("#builder-route-source-2-all-0", "question-2");
    await click("Add any-match rule group to question 3");
    await change("#builder-route-source-2-any-0", "question-1");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"all": [');
    expect(html).toContain('"any": [');
    expect(checkHtml(html, { fileName: "mixed-routing.html" }).ok).toBe(true);
  });

  it("routes a later question using a numeric comparison", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "number");
    await click("Add question");
    await click("Add all-match rule group to question 2");
    await change("#builder-route-source-1-all-0", "question-1");
    const rule = Array.from(host.querySelectorAll("select")).find((select) => Array.from(select.options).some((option) => option.textContent === "is greater than"));
    expect(rule).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rule!), "value")?.set?.call(rule!, "gt");
      rule!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const value = Array.from(host.querySelectorAll("input[type=number]")).find((input) => input.closest("label")?.textContent?.includes("Value"));
    expect(value).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value!), "value")?.set?.call(value!, "5");
      value!.dispatchEvent(new Event("input", { bubbles: true }));
      value!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"operator": "gt"');
    expect(html).toContain('"value": 5');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("requires an explicit valid date before using a date comparison", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "date");
    await click("Add question");
    await click("Add all-match rule group to question 2");
    await change("#builder-route-source-1-all-0", "question-1");
    const rule = Array.from(host.querySelectorAll("select")).find((select) => Array.from(select.options).some((option) => option.textContent === "is less than"));
    expect(rule).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rule!), "value")?.set?.call(rule!, "lt");
      rule!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Use questionnaire")?.disabled).toBe(true);
    await change('input[type="date"]', "2024-03-01");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"value": "2024-03-01"');
    expect(html).not.toContain("2020-01-01");
    expect(checkHtml(html, { fileName: "generated-date-route.html" }).ok).toBe(true);
  });

  it("generates optional comment fields and bounded checkbox selections", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "multi");
    const noteToggle = host.querySelector<HTMLInputElement>("#builder-note-0");
    expect(noteToggle).not.toBeNull();
    await act(async () => noteToggle!.click());
    await change("#builder-min-selections-0", "1");
    await change("#builder-max-selections-0", "2");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"note": true');
    expect(html).toContain('"minSelections": 1');
    expect(html).toContain('"maxSelections": 2');
    expect(html).toContain('data-kqa-note="question-1"');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("randomizes choice order with fixed and exclusive options", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "multi");
    await toggle("#builder-randomize-options-0");
    expect(host.querySelector<HTMLInputElement>("#builder-fixed-option-0-0")?.disabled).toBe(true);
    await click("Add choice");
    expect(host.querySelector<HTMLInputElement>("#builder-fixed-option-0-0")?.disabled).toBe(false);
    await toggle("#builder-fixed-option-0-0");
    await toggle("#builder-exclusive-option-0-1");
    await change('input[value="option-1"]', "primary");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"randomizeOptions": true');
    expect(html).toContain('"fixedOptionValues": [\n        "primary"');
    expect(html).toContain('"exclusiveOptions": [\n        "option-2"');
    expect(checkHtml(html, { fileName: "randomized-choices.html" }).ok).toBe(true);
  });

  it("allocates an unused choice value after removing a middle option", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add choice");
    await click("Remove choice 2 from question 1");
    await click("Add choice");
    await click("Use questionnaire");

    const html = useHtml.mock.calls[0][0] as string;
    const match = html.match(/<script type="application\/json" id="kqa-manifest">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const manifest = JSON.parse(match![1]);
    expect(manifest.questions[0].options.map((option: { value: string }) => option.value)).toEqual(["option-1", "option-3", "option-2"]);
    expect(checkHtml(html, { fileName: "choice-values.html" }).ok).toBe(true);
  });

  it("prevents exclusive choices from conflicting with a multi-selection minimum", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "multi");
    await change("#builder-min-selections-0", "2");
    expect(host.querySelector<HTMLInputElement>("#builder-exclusive-option-0-0")?.disabled).toBe(true);
    await change("#builder-min-selections-0", "");
    await toggle("#builder-exclusive-option-0-0");
    await change("#builder-min-selections-0", "2");
    expect(host.querySelector<HTMLInputElement>("#builder-min-selections-0")?.value).toBe("");
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/minimum selections cannot be above 1/i);
  });

  it("sets a text answer length limit", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "text");
    await change("#builder-max-length-0", "80");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"maxLength": 80');
    expect(html).toContain('maxlength="80"');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("sets a number increment", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-type-0", "number");
    await change("#builder-step-0", "0.5");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"step": 0.5');
    expect(html).toContain('step="0.5"');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("builds a bounded repeat group with required typed fields", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    const note = host.querySelector<HTMLInputElement>("#builder-note-0");
    expect(note).not.toBeNull();
    await act(async () => note!.click());
    await change("#builder-type-0", "repeat");
    await change("#builder-label-0", "Which locations did you visit?");
    expect(host.querySelector("#builder-note-0")).toBeNull();
    await click("Add record field");
    await click("Remove field");
    await click("Add record field");
    expect(host.textContent).toContain("Stable field ID");
    await change('input[value="Field 1"]', "Location name");
    const fieldType = Array.from(host.querySelectorAll("select")).find((select) => select.closest("label")?.textContent?.includes("Type"));
    expect(fieldType).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(fieldType!), "value")?.set?.call(fieldType!, "single");
      fieldType!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"type": "repeat"');
    expect(html).toContain('"maxRows": 5');
    expect(html).not.toContain('"note": true');
    expect(html.match(/"id": "field-1"/g)).toHaveLength(1);
    expect(html).toContain('"label": "Location name"');
    expect(html).toContain('data-kqa-repeat-template="question-1"');
    expect(html).toContain('data-kqa-repeat-field="field-2" value="option-1"');
    expect(checkHtml(html, { fileName: "generated-repeat.html" }).ok).toBe(true);
  });

  it("selects guided sections and assigns current questions automatically", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await change("#builder-presentation", "guided");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    expect(html).toContain('"presentation": "guided"');
    expect(html).toContain('"section": "section-1"');
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("creates an opt-in group, keeps membership through question ID edits, and clears it for guided flow", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await toggle('input[aria-label="Include question 1 in an order group"]');
    await toggle('input[aria-label="Include question 2 in an order group"]');
    await click("Add selected questions as a group");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Move question 1 down"]')?.disabled).toBe(true);
    await change("#builder-id-0", "intro-question");
    await click("Use questionnaire");
    let html = useHtml.mock.calls[0][0] as string;
    let manifest = JSON.parse(html.match(/<script type="application\/json" id="kqa-manifest">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(manifest.questionOrderGroups).toEqual([{ id: "question-order-1", questionIds: ["intro-question", "question-2"] }]);
    expect(checkHtml(html, { fileName: "grouped.html" })).toMatchObject({ ok: true, diagnostics: [] });

    await change("#builder-presentation", "guided-question");
    await click("Use questionnaire");
    html = useHtml.mock.calls[1][0] as string;
    manifest = JSON.parse(html.match(/<script type="application\/json" id="kqa-manifest">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(manifest.questionOrderGroups).toBeUndefined();
    expect(checkHtml(html, { fileName: "guided.html" })).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("repairs group membership when a member question is deleted", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(BasicQuestionnaireBuilder, { onUse: useHtml })));
    await click("Add question");
    await click("Add question");
    for (const index of [1, 2, 3]) await toggle(`input[aria-label="Include question ${index} in an order group"]`);
    await click("Add selected questions as a group");
    await click("Remove question 2");
    await click("Use questionnaire");
    const html = useHtml.mock.calls[0][0] as string;
    const manifest = JSON.parse(html.match(/<script type="application\/json" id="kqa-manifest">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(manifest.questionOrderGroups).toEqual([{ id: "question-order-1", questionIds: ["question-1", "question-3"] }]);
    expect(checkHtml(html, { fileName: "grouped-after-delete.html" })).toMatchObject({ ok: true, diagnostics: [] });
  });
});
