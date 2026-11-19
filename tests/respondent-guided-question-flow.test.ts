// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RespondentShell } from "../src/components/RespondentShell";
import { respondentMessage } from "../src/lib/respondent-locale";

const state = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));
vi.mock("../src/components/ui", async () => {
  const actual = await vi.importActual<typeof import("../src/components/ui")>("../src/components/ui");
  return { ...actual, api: state.api, useToast: () => state.toast, BrandMark: () => createElement("span", null, "KQA"), Icon: () => null, Spinner: () => null };
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset().mockResolvedValue({ ok: true, status: 200, data: {
    ok: true,
    participant: { name: "Ada", status: "in_progress" },
    interview: { name: "Study", status: "open" },
    version: 1,
    title: "Study questions",
    presentation: "guided-question",
    sections: [{ id: "work", title: "Work" }, { id: "goals", title: "Goals" }],
    questions: [
      { id: "one", type: "text", section: "work", label: "First question" },
      { id: "two", type: "text", section: "goals", label: "Second question" },
      { id: "three", type: "text", section: "work", label: "Third question" },
    ],
    answers: {},
    progress: { eligible: { one: true, two: true, three: true } },
  } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function start(locale = "en-AU") {
  await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token", initialLocale: locale as "en-AU" })); await Promise.resolve(); });
  const iframe = host.querySelector("iframe")!;
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "hello", lang: "en", dir: "ltr" }, origin: "null", source: iframe.contentWindow })));
  return { iframe, postMessage };
}

const findButton = (name: string) => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)!;

describe("guided question respondent flow", () => {
  it("steps through authored question order, validates one question, and supports Back", async () => {
    const { postMessage } = await start();
    const init = postMessage.mock.calls.map(([message]) => message as any).find((message) => message.type === "init");
    expect(init).toMatchObject({ guided: true, guidedQuestion: "one" });
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 1 of 3");

    await act(async () => findButton("Continue").click());
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 2 of 3");
    expect(host.querySelector(".rs-guided")?.textContent).toContain("Goals");
    expect(postMessage.mock.calls.map(([message]) => message as any).some((message) => message.type === "guided" && message.question === "two")).toBe(true);

    await act(async () => findButton("Back").click());
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 1 of 3");
    expect(host.querySelector(".rs-guided")?.textContent).toContain("Work");
  });

  it("blocks the current under-minimum answer after advancing past an optional blank question", async () => {
    state.api.mockResolvedValueOnce({ ok: true, status: 200, data: {
      ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
      version: 1, title: "Study questions", presentation: "guided-question", sections: [{ id: "work", title: "Work" }],
      questions: [
        { id: "optional", type: "text", section: "work", label: "Optional prompt" },
        { id: "choices", type: "multi", section: "work", label: "Choose enough", minSelections: 2, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }] },
        { id: "later", type: "text", section: "work", label: "Later" },
      ],
      answers: { choices: { value: ["a"], updatedAt: "now" } },
      progress: { eligible: { optional: true, choices: true, later: true } },
    } });
    await start();
    await act(async () => findButton("Continue").click());
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 2 of 3");
    await act(async () => findButton("Continue").click());
    expect(host.querySelector(".rs-guided-error")?.textContent).toContain("Choose at least 2 options");
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 2 of 3");
  });

  it("blocks Continue on an unanswered required current question", async () => {
    state.api.mockResolvedValueOnce({ ok: true, status: 200, data: {
      ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
      version: 1, title: "Study questions", presentation: "guided-question", sections: [{ id: "work", title: "Work" }],
      questions: [
        { id: "required", type: "text", section: "work", label: "Required prompt", required: true },
        { id: "later", type: "text", section: "work", label: "Later" },
      ],
      answers: {},
      progress: { eligible: { required: true, later: true } },
    } });
    await start();
    await act(async () => findButton("Continue").click());
    expect(host.querySelector(".rs-guided-error")?.textContent).toContain("Required prompt");
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 1 of 2");
  });

  it("skips a question that becomes ineligible and announces the localized question position", async () => {
    const { iframe } = await start("es");
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "eligibility", eligible: { one: false, two: true, three: true } }, origin: "null", source: iframe.contentWindow })));
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Pregunta 1 de 2");
    const status = host.querySelector(".rs-guided [role=status]")!;
    expect(status.textContent).toContain("Ahora se muestra la pregunta 1 de 2: Second question");
    expect(status.querySelector("bdi")?.textContent).toBe("Second question");
  });

  it("returns to a previously hidden question when its route becomes eligible again", async () => {
    const { iframe } = await start();
    await act(async () => findButton("Continue").click());
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 2 of 3");
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "eligibility", eligible: { one: true, two: false, three: true } }, origin: "null", source: iframe.contentWindow })));
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 2 of 2");
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "eligibility", eligible: { one: true, two: true, three: true } }, origin: "null", source: iframe.contentWindow })));
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 3 of 3");
    await act(async () => findButton("Back").click());
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 2 of 3");
  });

  it("returns from answer review to the exact question and offers review when none are eligible", async () => {
    const { postMessage } = await start();
    await act(async () => findButton("Review answers").click());
    expect(host.querySelector("[role=dialog]")).not.toBeNull();
    const edit = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).filter((button) => button.textContent?.trim() === "Answer")[2]!;
    await act(async () => edit.click());
    expect(host.querySelector(".rs-guided-count")?.textContent).toBe("Question 3 of 3");
    expect(postMessage.mock.calls.map(([message]) => message as any).some((message) => message.type === "focus-question" && message.id === "three")).toBe(true);

    const iframe = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "eligibility", eligible: { one: false, two: false, three: false } }, origin: "null", source: iframe.contentWindow })));
    expect(host.querySelector(".rs-guided-empty")?.textContent).toContain("no questions to complete");
    await act(async () => findButton("Review answers").click());
    expect(host.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("moves focus to the submitted status after the review dialog closes", async () => {
    await start();
    const reviewButton = findButton("Review answers");
    await act(async () => reviewButton.click());
    expect(host.querySelector("[role=dialog]")).not.toBeNull();

    const submitButton = findButton("Submit answers");
    await act(async () => {
      submitButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const submittedStatus = host.querySelector<HTMLDivElement>(".rs-banner.ok");
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(reviewButton.disabled).toBe(true);
    expect(submittedStatus).not.toBeNull();
    expect(submittedStatus?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(submittedStatus);
    expect(submittedStatus?.textContent).toContain("Submitted.");
    expect(document.activeElement).not.toBe(document.body);
    expect(submitButton.isConnected).toBe(false);
  });

  it("clears the active-question filter when switching to show all", async () => {
    const { postMessage } = await start();
    await act(async () => findButton("Show all questions").click());
    expect(host.querySelector(".rs-guided")).toBeNull();
    expect(postMessage.mock.calls.map(([message]) => message as any).some((message) => message.type === "guided" && message.enabled === false)).toBe(true);
  });

  it("provides localized position, route-change, and empty-state messages in every supported shell locale", () => {
    const expected = [
      ["en-AU", "Question 2 of 4: Label", "The available questions changed. Now showing question 2 of 4: Label"],
      ["vi", "Câu hỏi 2 trên 4: Label", "Danh sách câu hỏi đã thay đổi. Đang hiển thị câu hỏi 2 trên 4: Label"],
      ["es", "Pregunta 2 de 4: Label", "Las preguntas disponibles han cambiado. Ahora se muestra la pregunta 2 de 4: Label"],
      ["ar", "السؤال 2 من 4: Label", "تغيّرت الأسئلة المتاحة. يظهر الآن السؤال 2 من 4: Label"],
    ] as const;
    for (const [locale, position, changed] of expected) {
      expect(respondentMessage(locale, "questionAnnouncement", { index: 2, total: 4, question: "Label" })).toBe(position);
      expect(respondentMessage(locale, "availableQuestionAnnouncement", { index: 2, total: 4, question: "Label" })).toBe(changed);
      expect(respondentMessage(locale, "noEligibleQuestionsDescription")).toBeTruthy();
    }
  });
});
