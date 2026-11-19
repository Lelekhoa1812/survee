// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RespondentShell } from "../src/components/RespondentShell";

const state = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));

vi.mock("../src/components/ui", async () => {
  const actual = await vi.importActual<typeof import("../src/components/ui")>("../src/components/ui");
  return {
    ...actual,
    api: state.api,
    useToast: () => state.toast,
    BrandMark: () => createElement("span", null, "KQA"),
    Icon: () => null,
    Spinner: () => null,
  };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      participant: { name: "Ada", status: "in_progress" },
      interview: { name: "Study", status: "open" },
      version: 7,
      title: "Study questions",
      questions: [
        { id: "first-required", type: "text", label: "First required question", required: true },
        { id: "already-answered", type: "text", label: "Already answered question" },
      ],
      answers: { "already-answered": { value: "Done", updatedAt: "2026-11-16T00:00:00.000Z" } },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  host.remove();
});

describe("respondent required-answer recovery", () => {
  it("switches shell locale and direction while initializing the authored questionnaire independently", async () => {
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token", initialLocale: "en-AU" }));
      await Promise.resolve();
    });
    const shell = host.querySelector<HTMLElement>(".rs")!;
    const selector = host.querySelector<HTMLSelectElement>(".rs-language select")!;
    expect(shell.getAttribute("lang")).toBe("en-AU");
    expect(shell.getAttribute("dir")).toBe("ltr");
    selector.value = "ar";
    await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));
    expect(shell.getAttribute("lang")).toBe("ar");
    expect(shell.getAttribute("dir")).toBe("rtl");
    const frame = host.querySelector("iframe")!;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
      data: { kqa: 1, type: "hello", lang: "fr-CA", dir: "ltr" }, origin: "null", source: frame.contentWindow,
    })));
    const init = postMessage.mock.calls.map(([message]) => message).find((message: any) => message.type === "init") as any;
    expect(init.locale).toBe("ar");
    expect(init.messages.rankConfirm).toBe("استخدام هذا الترتيب");
    expect(init.messages.lengthCount).toContain("{count}");
    expect(shell.getAttribute("lang")).toBe("ar");
  });

  it("renders respondent navigation in each supported shell locale", async () => {
    const cases = [
      { locale: "vi", lang: "vi", dir: "ltr", review: "Xem lại câu trả lời" },
      { locale: "es", lang: "es", dir: "ltr", review: "Revisar las respuestas" },
      { locale: "ar", lang: "ar", dir: "rtl", review: "مراجعة الإجابات" },
    ];
    for (const [index, item] of cases.entries()) {
      if (index === 0) {
        await act(async () => {
          root.render(createElement(RespondentShell, { token: "participant-token", initialLocale: "vi" }));
          await Promise.resolve();
        });
      } else {
        const selector = host.querySelector<HTMLSelectElement>(".rs-language select")!;
        selector.value = item.locale;
        await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));
      }
      const shell = host.querySelector<HTMLElement>(".rs")!;
      expect(shell.getAttribute("lang")).toBe(item.lang);
      expect(shell.getAttribute("dir")).toBe(item.dir);
      expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.trim() === item.review)).toBe(true);
    }
  });

  it("isolates authored question text and language inside Arabic shell validation", async () => {
    state.api.mockResolvedValueOnce({
      ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        questions: [{ id: "bounded", type: "text", label: "What changed?" }],
        answers: {},
      },
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token", initialLocale: "ar" }));
      await Promise.resolve();
    });
    const frame = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
      data: { kqa: 1, type: "hello", lang: "en", dir: "ltr" }, origin: "null", source: frame.contentWindow,
    })));
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
      data: { kqa: 1, type: "length-draft", id: "bounded", valid: false, count: 22, max: 20 }, origin: "null", source: frame.contentWindow,
    })));

    const isolated = host.querySelector<HTMLElement>('.rs-banner.warn bdi[dir="auto"]')!;
    expect(isolated.textContent).toBe("What changed?");
    expect(isolated.getAttribute("lang")).toBe("en");
    expect(host.querySelector<HTMLElement>(".rs")?.getAttribute("dir")).toBe("rtl");
  });

  it("lets a respondent open the review when every required answer is empty", async () => {
    state.api.mockResolvedValueOnce({
      ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        questions: [{ id: "required", type: "text", label: "Required answer", required: true }],
        answers: {},
      },
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const reviewButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!;
    expect(reviewButton.disabled).toBe(false);
    await act(async () => reviewButton.click());
    const review = host.querySelector("[role=dialog]")!;
    expect(review.textContent).toContain("Required answer");
    expect(review.textContent).toContain("Answer this required question.");
    expect(Array.from(review.querySelectorAll("button")).some((button) => button.textContent?.includes("Submit answers"))).toBe(false);
  });

  it("offers a built-in clear action for an answered item in the pre-submit review", async () => {
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const reviewButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!;
    await act(async () => reviewButton.click());
    const review = host.querySelector("[role=dialog]")!;
    const iframe = host.querySelector("iframe")!;
    expect(review.querySelector<HTMLButtonElement>('[aria-label="Clear answer to Already answered question"]')!.disabled).toBe(true);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "hello" },
        origin: "null",
        source: iframe.contentWindow,
      }));
    });
    const clearButton = review.querySelector<HTMLButtonElement>('[aria-label="Clear answer to Already answered question"]')!;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    expect(clearButton.disabled).toBe(false);
    expect(review.textContent).toContain("any optional note stays saved");
    await act(async () => clearButton.click());
    expect(postMessage).toHaveBeenCalledWith({ kqa: 1, type: "clear-answer", id: "already-answered" }, "*");
    expect(host.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("keeps the review open and maps server validation errors to their answers", async () => {
    state.api.mockImplementation(async (url: string) => url.endsWith("/submit")
      ? { ok: false, status: 422, data: { error: "Some answers need attention.", missing: [], invalidSelections: [{ id: "channels", selected: 2, maximum: 1 }], invalidRankSelections: [{ id: "priorities" }] } }
      : {
        ok: true, status: 200, data: {
          ok: true,
          participant: { name: "Ada", status: "in_progress" },
          interview: { name: "Study", status: "open" },
          version: 7,
          title: "Study questions",
          questions: [
            { id: "channels", type: "multi", label: "Which channels?", options: [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }] },
            { id: "priorities", type: "rank", label: "Order priorities", options: [{ value: "cost", label: "Cost" }, { value: "speed", label: "Speed" }] },
          ],
          answers: { channels: { value: ["email", "phone"], updatedAt: "now" }, priorities: { value: ["speed"], updatedAt: "now" } },
        },
      });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const reviewButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!;
    await act(async () => reviewButton.click());
    const submit = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent?.includes("Submit answers"))!;
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    const review = host.querySelector("[role=dialog]")!;
    expect(review).not.toBeNull();
    expect(review.querySelector('[role="alert"]')?.textContent).toContain("Some answers need attention.");
    expect(review.textContent).toContain("Choose no more than 1 option.");
    expect(review.textContent).toContain("Rank every current option exactly once, then choose Use this order.");
    expect(review.textContent).toContain("Email; Phone");
  });

  it("states that offline edits have not synced", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "set", id: "already-answered", value: "Unsynced edit" },
        origin: "null",
        source: frame.contentWindow,
      }));
      window.dispatchEvent(new Event("offline"));
    });
    const status = host.querySelector(".save-state")!;
    expect(status.textContent).toContain("Offline — changes waiting to sync");
    expect(status.getAttribute("title")).toContain("These changes have not reached survee");
  });

  it("lists a saved multi-select answer that exceeds its current cap", async () => {
    state.api.mockResolvedValueOnce({
      ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        questions: [{ id: "channels", type: "multi", label: "Which channels?", maxSelections: 1, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }],
        answers: { channels: { value: ["a", "b"], updatedAt: "now" } },
      },
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const submit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!;
    await act(async () => submit.click());
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Choose no more than 1 option.");
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Which channels?");
  });

  it("returns focus to the first missing question after the warning closes", async () => {
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });

    const submit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!;
    const frame = host.querySelector("iframe")!;
    const postMessage = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: postMessage });
    submit.focus();
    await act(async () => submit.click());

    const answer = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Answer")!;
    await act(async () => answer.click());

    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(submit);
    expect(postMessage).toHaveBeenCalledWith({ kqa: 1, type: "focus-question", id: "first-required" }, "*");
  });

  it("keeps hidden retained answers collapsed and lets respondents clear their saved value or note", async () => {
    state.api.mockResolvedValueOnce({
      ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        questions: [
          { id: "choice", type: "single", label: "Choose one", options: [{ value: "yes", label: "Yes, please" }, { value: "no", label: "No" }] },
          { id: "channels", type: "multi", label: "Which channels?", options: [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }] },
          { id: "reason", type: "text", label: "Any context?", note: true },
          { id: "hidden", type: "text", label: "Hidden follow-up", note: true },
        ],
        answers: {
          choice: { value: "yes", updatedAt: "now" },
          channels: { value: ["email", "phone"], updatedAt: "now" },
          reason: { value: "Useful context", note: "For the host", updatedAt: "now" },
          hidden: { value: "Retained answer", note: "Retained note", updatedAt: "now" },
        },
        progress: { eligible: { choice: true, channels: true, reason: true, hidden: false } },
      },
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const submit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!;
    await act(async () => submit.click());
    const review = host.querySelector("[role=dialog]")!;
    const retained = review.querySelector<HTMLDetailsElement>(".review-retained")!;
    expect(retained.open).toBe(false);
    expect(review.textContent).toContain("Yes, please");
    expect(review.textContent).toContain("Email; Phone");
    expect(review.textContent).toContain("Useful context");
    expect(review.textContent).toContain("For the host");
    expect(retained.textContent).toContain("Hidden follow-up");
    expect(retained.textContent).toContain("Retained answer");
    expect(retained.textContent).toContain("Retained note");
    expect(retained.textContent).toContain("clearing one does not change the answer that controls routing");
    const frame = host.querySelector("iframe")!;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    await act(async () => { retained.querySelector("summary")!.click(); });
    const clearValue = retained.querySelector<HTMLButtonElement>('[aria-label="Clear saved answer to Hidden follow-up"]')!;
    const clearNote = retained.querySelector<HTMLButtonElement>('[aria-label="Clear saved note for Hidden follow-up"]')!;
    expect(clearValue.disabled).toBe(true);
    expect(clearNote.disabled).toBe(true);
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "hello" }, origin: "null", source: frame.contentWindow })));
    expect(clearValue.disabled).toBe(false);
    expect(clearNote.disabled).toBe(false);
    await act(async () => clearValue.click());
    await act(async () => clearNote.click());
    expect(postMessage).toHaveBeenCalledWith({ kqa: 1, type: "clear-answer", id: "hidden" }, "*");
    expect(postMessage).toHaveBeenCalledWith({ kqa: 1, type: "clear-note", id: "hidden" }, "*");
  });

  it("navigates eligible questions by section and focuses the chosen question", async () => {
    state.api.mockResolvedValueOnce({
      ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        sections: [{ id: "context", title: "About you", description: "A little context." }],
        questions: [
          { id: "role", type: "text", label: "Your role", section: "context" },
          { id: "goal", type: "text", label: "Your goal", section: "context", required: true },
          { id: "followup", type: "text", label: "Hidden follow-up", section: "context" },
          { id: "closing", type: "longtext", label: "Anything else?" },
        ],
        answers: { role: { value: "Researcher", updatedAt: "now" } },
        progress: { eligible: { role: true, goal: true, followup: false, closing: true } },
      },
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });

    const trigger = host.querySelector<HTMLButtonElement>(".rs-question-nav-trigger")!;
    expect(trigger.getAttribute("aria-label")).toBe("Browse questions, 1 of 3 answered");
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "hello" }, origin: "null", source: frame.contentWindow,
      }));
    });
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    const nav = host.querySelector<HTMLElement>("#respondent-question-navigation")!;
    expect(nav.textContent).toContain("About you");
    expect(nav.textContent).toContain("1 of 2 answered");
    expect(nav.textContent).toContain("Other questions");
    expect(nav.textContent).toContain("Questions hidden by your answers are omitted");
    expect(nav.textContent).not.toContain("Hidden follow-up");

    const postMessage = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: postMessage });
    vi.useFakeTimers();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "set", id: "goal", value: "Improve access" },
        origin: "null", source: frame.contentWindow,
      }));
    });
    expect(trigger.getAttribute("aria-label")).toBe("Browse questions, 2 of 3 answered");
    expect(nav.textContent).toContain("2 of 2 answered");
    const jump = Array.from(nav.querySelectorAll("button")).find((button) => button.textContent?.includes("Your goal"))!;
    await act(async () => jump.click());
    expect(host.querySelector("#respondent-question-navigation")).toBeNull();
    expect(postMessage).toHaveBeenCalledWith({ kqa: 1, type: "focus-question", id: "goal" }, "*");
  });

  it("closes question navigation with Escape and restores focus to its trigger", async () => {
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const trigger = host.querySelector<HTMLButtonElement>(".rs-question-nav-trigger")!;
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "hello" }, origin: "null", source: frame.contentWindow,
      }));
    });
    await act(async () => trigger.click());
    const nav = host.querySelector<HTMLElement>("#respondent-question-navigation")!;
    await act(async () => nav.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(host.querySelector("#respondent-question-navigation")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("locks a stale questionnaire and offers a copyable unsaved draft before reload", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation(async (url: string) => {
      if (url.endsWith("/answers")) return { ok: false, status: 409, data: { ok: false, error: "updated", code: "questionnaire_version_changed" } };
      return {
        ok: true,
        status: 200,
        data: {
          ok: true,
          participant: { name: "Ada", status: "in_progress" },
          interview: { name: "Study", status: "open" },
          version: 7,
          title: "Study questions",
          questions: [{ id: "answer", type: "text", label: "Answer" }],
          answers: {},
        },
      };
    });

    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const frame = host.querySelector("iframe")!;
    const framePost = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: framePost });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "set", id: "answer", value: "unsaved edit" },
        origin: "null",
        source: frame.contentWindow,
      }));
      await vi.advanceTimersByTimeAsync(650);
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("newer edits on this page were rejected");
    expect(alert?.textContent).toContain("Review unsaved changes");
    expect(alert?.textContent).toContain("Reload questionnaire");
    expect(framePost).toHaveBeenCalledWith({ kqa: 1, type: "lock", locked: true }, "*");
    const answerSave = state.api.mock.calls.find(([url]) => String(url).endsWith("/answers"));
    expect(answerSave?.[1]).toMatchObject({ body: { version: 7, answers: { answer: { value: "unsaved edit" } } } });
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    await act(async () => Array.from(alert!.querySelectorAll("button")).find((button) => button.textContent === "Review unsaved changes")!.click());
    const recovery = host.querySelector('[role="dialog"]')!;
    expect(recovery.textContent).toContain("Answer");
    expect(recovery.textContent).toContain("unsaved edit");
    expect(recovery.textContent).toContain("not apply them to newer questions automatically");
    expect(recovery.querySelector<HTMLTextAreaElement>("#conflict-draft-copy")?.value).toContain('"value": "unsaved edit"');
    vi.useRealTimers();
  });

  it("preserves a rejected scalar draft after a locked save without retrying it", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation(async (url: string) => url.endsWith("/answers")
      ? { ok: false, status: 403, data: { ok: false, error: "locked" } }
      : { ok: true, status: 200, data: {
          ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
          version: 7, title: "Study questions", questions: [{ id: "answer", type: "text", label: "Answer" }], answers: {},
        } });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "set", id: "answer", value: "keep this draft" }, origin: "null", source: frame.contentWindow }));
      await vi.advanceTimersByTimeAsync(650);
    });
    const banner = host.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain("Review unsaved changes");
    expect(host.querySelector(".save-state")?.textContent).toContain("Not saved");
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(1);
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    await act(async () => Array.from(banner.querySelectorAll("button")).find((button) => button.textContent === "Review unsaved changes")!.click());
    expect(host.querySelector<HTMLTextAreaElement>("#conflict-draft-copy")?.value).toContain('"value": "keep this draft"');
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(1);
    vi.useRealTimers();
  });

  it("keeps a locked page-exit draft copyable", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation(async (url: string) => url.endsWith("/answers")
      ? { ok: false, status: 403, data: { ok: false, error: "locked" } }
      : { ok: true, status: 200, data: {
          ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
          version: 7, title: "Study questions", questions: [{ id: "answer", type: "text", label: "Answer" }], answers: {},
        } });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "set", id: "answer", value: "exit draft" }, origin: "null", source: frame.contentWindow })); });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    const banner = host.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain("Review unsaved changes");
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(1);
    await act(async () => Array.from(banner.querySelectorAll("button")).find((button) => button.textContent === "Review unsaved changes")!.click());
    expect(host.querySelector<HTMLTextAreaElement>("#conflict-draft-copy")?.value).toContain('"value": "exit draft"');
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.useRealTimers();
  });

  it("recovers a page-exit record conflict and saves only scalar edits", async () => {
    vi.useFakeTimers();
    let loads = 0;
    state.api.mockImplementation(async (url: string, options?: any) => {
      if (url.endsWith("/answers")) {
        if (options?.body?.recordOperations?.length) return { ok: false, status: 409, data: { ok: false, code: "record_field_conflict", recordErrors: [{ questionId: "records", rowId: "row-1", fieldId: "name", reason: "stale" }] } };
        return { ok: true, status: 200, data: { savedAt: "2026-11-20T00:00:00.000Z", recordGroups: { records: [] } } };
      }
      loads += 1;
      return { ok: true, status: 200, data: {
        ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
        version: 7, title: "Study questions",
        questions: [{ id: "answer", type: "text", label: "Answer" }, { id: "records", type: "repeat", label: "Records", fields: [] }],
        answers: { answer: { value: "server", updatedAt: "2026-11-20T00:00:00.000Z" } }, recordGroups: { records: [] },
      } };
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const framePost = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: framePost });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "set", id: "answer", value: "exit scalar" }, origin: "null", source: frame.contentWindow }));
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "record-operation", operationId: "exit-record", operation: { op: "add", questionId: "records", rowId: "row-1" } }, origin: "null", source: frame.contentWindow }));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); await Promise.resolve(); });
    expect(loads).toBe(2);
    const writes = state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"));
    expect(writes).toHaveLength(2);
    expect(writes[1][1].body).toMatchObject({ answers: { answer: { value: "exit scalar" } }, recordOperations: [] });
    const rejected = framePost.mock.calls.map(([message]) => message as any).filter((message) => message.type === "record-rejected").flatMap((message) => message.rejectedOperationIds);
    expect(rejected).toContain("exit-record");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Review unsaved changes");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.useRealTimers();
  });

  it("keeps the newest in-flight edits and separate question changes in the recovery snapshot", async () => {
    vi.useFakeTimers();
    let resolveSave!: (value: { ok: boolean; status: number; data: { error: string; code: string } }) => void;
    state.api.mockImplementation((url: string) => {
      if (url.endsWith("/answers")) return new Promise((resolve) => { resolveSave = resolve; });
      return Promise.resolve({ ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        questions: [
          { id: "answer", type: "text", label: "Answer", note: true },
          { id: "other", type: "text", label: "Another answer" },
        ],
        answers: {},
      } });
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const frame = host.querySelector("iframe")!;
    const send = (id: string, part: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", {
      data: { kqa: 1, type: "set", id, ...part }, origin: "null", source: frame.contentWindow,
    }));

    await act(async () => {
      send("answer", { value: "first draft" });
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(1);

    await act(async () => {
      send("answer", { value: "newer draft", note: "newer note" });
      send("other", { value: "separate draft" });
      await vi.advanceTimersByTimeAsync(650);
    });
    await act(async () => {
      resolveSave({ ok: false, status: 409, data: { error: "updated", code: "questionnaire_version_changed" } });
      await Promise.resolve();
    });
    const banner = host.querySelector('[role="alert"]')!;
    await act(async () => Array.from(banner.querySelectorAll("button")).find((button) => button.textContent === "Review unsaved changes")!.click());
    const draft = host.querySelector<HTMLTextAreaElement>("#conflict-draft-copy")!.value;
    expect(draft).toContain('"value": "newer draft"');
    expect(draft).toContain('"note": "newer note"');
    expect(draft).toContain('"value": "separate draft"');
    expect(draft).not.toContain("first draft");
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(1);
    vi.useRealTimers();
  });

  it("serializes record-conflict refresh and preserves edits queued while it is pending", async () => {
    vi.useFakeTimers();
    let resolveRefresh!: (value: any) => void;
    let loads = 0;
    const saved = (answers: Record<string, unknown> = {}) => ({ ok: true, status: 200, data: {
      ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
      version: 7, title: "Study questions",
      questions: [{ id: "answer", type: "text", label: "Answer" }, { id: "records", type: "repeat", label: "Records", fields: [] }],
      answers, recordGroups: { records: [] },
    } });
    state.api.mockImplementation((url: string, options?: any) => {
      if (url.endsWith("/answers")) {
        if (options?.body?.recordOperations?.length) return Promise.resolve({ ok: false, status: 409, data: { ok: false, code: "record_row_conflict", recordErrors: [{ questionId: "records", reason: "stale" }] } });
        return Promise.resolve({ ok: true, status: 200, data: { savedAt: "2026-11-20T00:00:00.000Z", recordGroups: { records: [] } } });
      }
      loads += 1;
      return loads === 1 ? Promise.resolve(saved()) : new Promise((resolve) => { resolveRefresh = resolve; });
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const framePost = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: framePost });
    const send = (data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, ...data }, origin: "null", source: frame.contentWindow }));
    await act(async () => {
      send({ type: "set", id: "answer", value: "before conflict" });
      send({ type: "record-operation", operationId: "record-old", operation: { op: "add", questionId: "records", rowId: "row-old" } });
      await vi.advanceTimersByTimeAsync(650);
      await Promise.resolve();
    });
    expect(loads).toBe(2);
    await act(async () => {
      send({ type: "set", id: "answer", value: "newer during refresh" });
      send({ type: "record-operation", operationId: "record-later", operation: { op: "add", questionId: "records", rowId: "row-later" } });
      await Promise.resolve();
    });
    await act(async () => {
      resolveRefresh(saved({ answer: { value: "server value", updatedAt: "2026-11-20T00:00:00.000Z" } }));
      await Promise.resolve();
    });
    const rejected = framePost.mock.calls.map(([message]) => message as any).filter((message) => message.type === "record-rejected").flatMap((message) => message.rejectedOperationIds);
    expect(rejected).toContain("record-old");
    expect(rejected).toContain("record-later");
    await act(async () => { await Promise.resolve(); });
    const writes = state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"));
    expect(writes).toHaveLength(2);
    expect(writes[1][1].body).toMatchObject({ answers: { answer: { value: "newer during refresh" } }, recordOperations: [] });
    expect(framePost.mock.calls.map(([message]) => message as any).filter((message) => message.type === "answers").at(-1).answers.answer.value).toBe("newer during refresh");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Review unsaved changes");
    vi.useRealTimers();
  });

  it("keeps conflicted repeat edits in review when the authoritative refresh fails", async () => {
    vi.useFakeTimers();
    let loads = 0;
    state.api.mockImplementation(async (url: string) => {
      if (url.endsWith("/answers")) return { ok: false, status: 409, data: { ok: false, code: "record_row_conflict", recordErrors: [{ questionId: "records", reason: "stale" }] } };
      loads += 1;
      if (loads > 1) return { ok: false, status: 503, data: { ok: false, error: "temporarily unavailable" } };
      return { ok: true, status: 200, data: {
        ok: true, participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
        version: 7, title: "Study questions",
        questions: [{ id: "records", type: "repeat", label: "Records", fields: [] }, { id: "other-records", type: "repeat", label: "Other records", fields: [] }], answers: {}, recordGroups: { records: [], "other-records": [] },
      } };
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const framePost = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: framePost });
    const send = (operationId: string, questionId: string, rowId: string) => window.dispatchEvent(new MessageEvent("message", { data: {
      kqa: 1, type: "record-operation", operationId, operation: { op: "add", questionId, rowId },
    }, origin: "null", source: frame.contentWindow }));
    await act(async () => { send("record-stale", "records", "row-stale"); await vi.advanceTimersByTimeAsync(650); await Promise.resolve(); });
    expect(loads).toBe(2);
    await act(async () => { send("record-after-failed-refresh", "records", "row-new"); send("other-question-op", "other-records", "row-other"); await vi.advanceTimersByTimeAsync(650); await Promise.resolve(); });
    expect(loads).toBe(3);
    await act(async () => { send("record-after-second-failed-refresh", "records", "row-newer"); await Promise.resolve(); });
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(2);
    const rejected = framePost.mock.calls.map(([message]) => message as any).filter((message) => message.type === "record-rejected").flatMap((message) => message.rejectedOperationIds);
    expect(rejected).toContain("record-stale");
    expect(rejected).toContain("record-after-failed-refresh");
    expect(rejected).toContain("other-question-op");
    expect(rejected).toContain("record-after-second-failed-refresh");
    const banner = Array.from(host.querySelectorAll('[role="alert"]')).find((alert) => alert.textContent?.includes("Review unsaved changes"))!;
    await act(async () => Array.from(banner.querySelectorAll("button")).find((button) => button.textContent === "Review unsaved changes")!.click());
    expect(host.querySelector<HTMLTextAreaElement>("#conflict-draft-copy")?.value).toContain("record-after-failed-refresh");
    vi.useRealTimers();
  });

  it.each([false, true])("keeps the autosave timer through a render and locale change (change locale: %s)", async (changeLocale) => {
    vi.useFakeTimers();
    state.api.mockImplementation(async (url: string) => url.endsWith("/answers")
      ? { ok: true, status: 200, data: { savedAt: "2026-11-20T00:00:00.000Z" } }
      : { ok: true, status: 200, data: {
        participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version: 7,
        title: "Study", questions: [{ id: "answer", type: "text", label: "Answer" }], answers: {},
      } });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "set", id: "answer", value: "Pending autosave" }, origin: "null", source: frame.contentWindow }));
    });
    expect(host.textContent).toContain("Saving");
    if (changeLocale) {
      const selector = host.querySelector<HTMLSelectElement>(".rs-language select")!;
      selector.value = "es";
      await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));
      expect(host.querySelector(".rs")?.getAttribute("lang")).toBe("es");
    }
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    const writes = state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"));
    expect(writes).toHaveLength(1);
    expect(writes[0][1].body.answers).toEqual({ answer: { value: "Pending autosave" } });
    vi.useRealTimers();
  });

  it("blocks submission after discarded drafts until a successful retry refreshes the reviewed records", async () => {
    vi.useFakeTimers();
    let loads = 0;
    const saved = (name: string) => ({ ok: true, status: 200, data: {
      participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version: 7, title: "Study",
      questions: [{ id: "records", type: "repeat", label: "Records", fields: [{ id: "name", type: "text", label: "Name" }], maxRows: 3 }, { id: "answer", type: "text", label: "Answer" }],
      answers: {}, recordGroups: { records: [{ id: "r1", values: { name }, revision: 1, fieldRevisions: { name: 1 } }] },
    } });
    state.api.mockImplementation(async (url: string, options?: any) => {
      if (url.endsWith("/answers")) return options?.body?.recordOperations?.length ? { ok: false, status: 409, data: { code: "record_field_conflict", recordErrors: [] } } : { ok: true, status: 200, data: { savedAt: "2026-11-20T00:00:00.000Z" } };
      if (url.endsWith("/submit")) return { ok: true, status: 200, data: { submittedAt: "2026-11-20T00:00:00.000Z" } };
      loads += 1;
      return loads === 1 ? saved("Old value") : loads < 4 ? { ok: false, status: 503, data: {} } : saved("Latest value");
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "record-operation", operationId: "draft", operation: { op: "set", questionId: "records", rowId: "r1", fieldId: "name", value: "Draft", expectedFieldRevision: 1 } }, origin: "null", source: frame.contentWindow }));
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(host.textContent).toContain("Submission is blocked");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Some record changes were not saved")!.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent === "Discard draft")!.click());
    const submit = () => Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent?.includes("Submit answers"))!;
    expect(submit().disabled).toBe(true);
    await act(async () => submit().click());
    expect(state.api.mock.calls.some(([url]) => String(url).endsWith("/submit"))).toBe(false);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent === "Keep editing")!.click());
    const retry = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Retry loading records")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "set", id: "answer", value: "Pending scalar" }, origin: "null", source: frame.contentWindow }));
      retry().click();
      await Promise.resolve();
    });
    expect(loads).toBe(2);
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining("not saved yet"), "err", expect.anything());
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers")).at(-1)?.[1].body.answers).toEqual({ answer: { value: "Pending scalar" } });
    await act(async () => { retry().click(); await Promise.resolve(); });
    expect(host.textContent).toContain("Submission is blocked");
    await act(async () => { retry().click(); await Promise.resolve(); });
    expect(host.textContent).not.toContain("Submission is blocked");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!.click());
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Latest value");
    expect(submit().disabled).toBe(false);
    await act(async () => { submit().click(); await Promise.resolve(); });
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/submit"))).toHaveLength(1);
    vi.useRealTimers();
  });

  it("preserves rejected repeat drafts if the questionnaire changes during refresh retry", async () => {
    vi.useFakeTimers();
    let loads = 0;
    const loaded = (version: number) => ({ ok: true, status: 200, data: {
      participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version, title: "Study",
      questions: [{ id: "records", type: "repeat", label: "Records", fields: [], maxRows: 3 }], answers: {}, recordGroups: { records: [] },
    } });
    state.api.mockImplementation(async (url: string) => {
      if (url.endsWith("/answers")) return { ok: false, status: 409, data: { code: "record_row_conflict", recordErrors: [] } };
      loads += 1;
      return loads === 1 ? loaded(7) : loads === 2 ? { ok: false, status: 503, data: {} } : loaded(8);
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "record-operation", operationId: "draft-version", operation: { op: "add", questionId: "records", rowId: "row-draft" } }, origin: "null", source: frame.contentWindow }));
      await vi.advanceTimersByTimeAsync(650);
    });
    await act(async () => { Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Retry loading records")!.click(); await Promise.resolve(); });
    expect(host.textContent).toContain("This questionnaire changed");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review unsaved changes")!.click());
    expect(host.querySelector<HTMLTextAreaElement>("#conflict-draft-copy")?.value).toContain("draft-version");
    expect(state.api.mock.calls.some(([url]) => String(url).endsWith("/submit"))).toBe(false);
    vi.useRealTimers();
  });

  it("keeps page-exit edits pending after an HTTP failure and warns while the request is in flight", async () => {
    vi.useFakeTimers();
    let resolveExit!: (value: { ok: boolean; status: number; data: { error: string } }) => void;
    let answerRequests = 0;
    state.api.mockImplementation((url: string) => {
      if (url.endsWith("/answers")) {
        answerRequests += 1;
        if (answerRequests === 1) return new Promise((resolve) => { resolveExit = resolve; });
        return Promise.resolve({ ok: true, status: 200, data: { savedAt: "2026-11-19T00:00:00.000Z" } });
      }
      return Promise.resolve({ ok: true, status: 200, data: {
        ok: true,
        participant: { name: "Ada", status: "in_progress" },
        interview: { name: "Study", status: "open" },
        version: 7,
        title: "Study questions",
        questions: [{ id: "answer", type: "text", label: "Answer" }],
        answers: {},
      } });
    });
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "set", id: "answer", value: "page-exit draft" }, origin: "null", source: frame.contentWindow,
      }));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(state.api.mock.calls.find(([url]) => String(url).endsWith("/answers"))?.[1]).toMatchObject({ keepalive: true, body: { version: 7, answers: { answer: { value: "page-exit draft" } } } });
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    await act(async () => {
      resolveExit({ ok: false, status: 503, data: { error: "temporarily unavailable" } });
      await Promise.resolve();
    });
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(host.querySelector(".save-state")?.textContent).toContain("Offline — changes waiting to sync");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(answerRequests).toBe(2);
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/answers"))[1]?.[1]).toMatchObject({ body: { answers: { answer: { value: "page-exit draft" } } } });
    expect(host.querySelector(".save-state")?.textContent).toContain("Saved");
    vi.useRealTimers();
  });
  it("does not submit when the final save rejects a record draft, and permits submission after explicit discard", async () => {
    const loaded = { ok: true, status: 200, data: {
      participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" },
      version: 7, title: "Study", questions: [{ id: "records", type: "repeat", label: "Records", fields: [], maxRows: 3 }], answers: {}, recordGroups: {},
    } };
    state.api.mockImplementation((url: string) => {
      if (url.endsWith("/answers")) return Promise.resolve({ ok: false, status: 400, data: { recordErrors: [{ questionId: "records", rowId: "r1", reason: "Record conflict" }] } });
      if (url.endsWith("/submit")) return Promise.resolve({ ok: true, status: 200, data: { submittedAt: "2026-11-20T00:00:00Z" } });
      return Promise.resolve(loaded);
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "record-operation", operationId: "op1", operation: { op: "add", questionId: "records", rowId: "r1" } }, origin: "null", source: frame.contentWindow })));
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!.click());
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent?.includes("Submit answers"))!.click(); await Promise.resolve(); });
    expect(state.api.mock.calls.some(([url]) => String(url).endsWith("/submit"))).toBe(false);
    const submit = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent?.includes("Submit answers"))!;
    expect(submit.disabled).toBe(true);
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("This record needs attention.");
    expect(host.querySelector("[role=dialog]")?.textContent).not.toContain("Record conflict");
    const selector = host.querySelector<HTMLSelectElement>(".rs-language select")!;
    selector.value = "ar";
    await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("يحتاج هذا السجل إلى مراجعة");
    selector.value = "en-AU";
    await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent === "Discard draft")!.click());
    expect(submit.disabled).toBe(false);
    await act(async () => { submit.click(); await Promise.resolve(); });
    expect(state.api.mock.calls.filter(([url]) => String(url).endsWith("/submit"))).toHaveLength(1);
  });

  it("retranslates server repeat submission issues when the shell language changes", async () => {
    state.api.mockImplementation((url: string) => url.endsWith("/submit")
      ? Promise.resolve({ ok: false, status: 422, data: { repeatErrors: [{ questionId: "records", code: "required_field", reason: "Raw server message" }] } })
      : Promise.resolve({ ok: true, status: 200, data: {
        participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version: 7,
        title: "Study", questions: [{ id: "records", type: "repeat", label: "Records", fields: [], maxRows: 3 }], answers: {}, recordGroups: {},
      } }));
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!.click());
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent?.includes("Submit answers"))!.click(); await Promise.resolve(); });
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Complete this required field.");
    expect(host.querySelector("[role=dialog]")?.textContent).not.toContain("Raw server message");
    const selector = host.querySelector<HTMLSelectElement>(".rs-language select")!;
    selector.value = "es";
    await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Completa este campo obligatorio.");
  });

  it.each([false, true])("retains pending record drafts on version conflict (in-flight record: %s)", async (inFlightRecord) => {
    vi.useFakeTimers();
    let resolveSave!: (value: unknown) => void;
    state.api.mockImplementation((url: string) => {
      if (url.endsWith("/answers")) return new Promise((resolve) => { resolveSave = resolve; });
      return Promise.resolve({ ok: true, status: 200, data: {
        participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version: 7, title: "Study",
        questions: [{ id: "answer", type: "text", label: "Answer" }, { id: "records", type: "repeat", label: "Records", fields: [], maxRows: 3 }], answers: {}, recordGroups: {},
      } });
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const send = (data: object) => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, ...data }, origin: "null", source: frame.contentWindow }));
    await act(async () => {
      if (inFlightRecord) send({ type: "record-operation", operationId: "first", operation: { op: "add", questionId: "records", rowId: "r1" } });
      else send({ type: "set", id: "answer", value: "draft" });
      await vi.advanceTimersByTimeAsync(650);
      send({ type: "record-operation", operationId: "second", operation: { op: "add", questionId: "records", rowId: "r2" } });
      resolveSave({ ok: false, status: 409, data: { code: "questionnaire_version_changed" } });
      await Promise.resolve();
    });
    expect(host.textContent).toContain(`Record changes not saved: ${inFlightRecord ? 2 : 1}.`);
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Some record changes were not saved")!.click());
    expect(Array.from(host.querySelectorAll("[role=dialog] button")).filter((button) => button.textContent === "Discard draft")).toHaveLength(inFlightRecord ? 2 : 1);
    vi.useRealTimers();
  });

  it("does not submit while a save remains in flight past the wait limit", async () => {
    vi.useFakeTimers();
    state.api.mockImplementation((url: string) => {
      if (url.endsWith("/answers")) return new Promise(() => {});
      return Promise.resolve({ ok: true, status: 200, data: {
        participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version: 7, title: "Study",
        questions: [{ id: "answer", type: "text", label: "Answer" }], answers: {},
      } });
    });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "set", id: "answer", value: "unsaved" }, origin: "null", source: frame.contentWindow }));
      await vi.advanceTimersByTimeAsync(650);
      Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Review answers")!.click();
    });
    await act(async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((button) => button.textContent?.includes("Submit answers"))!.click();
      await vi.advanceTimersByTimeAsync(6200);
    });
    expect(state.api.mock.calls.some(([url]) => String(url).endsWith("/submit"))).toBe(false);
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining("not saved yet"), "err", expect.anything());
    vi.useRealTimers();
  });

});
