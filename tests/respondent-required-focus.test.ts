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
      ? { ok: false, status: 422, data: { error: "Some answers need attention.", missing: [], invalidSelections: [{ id: "channels", selected: 2, maximum: 1 }] } }
      : {
        ok: true, status: 200, data: {
          ok: true,
          participant: { name: "Ada", status: "in_progress" },
          interview: { name: "Study", status: "open" },
          version: 7,
          title: "Study questions",
          questions: [{ id: "channels", type: "multi", label: "Which channels?", options: [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }] }],
          answers: { channels: { value: ["email", "phone"], updatedAt: "now" } },
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
    expect(status.getAttribute("title")).toContain("These changes have not reached KQA");
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

  it("shows readable saved answers and notes while omitting currently inactive questions", async () => {
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
          { id: "hidden", type: "text", label: "Hidden follow-up" },
        ],
        answers: {
          choice: { value: "yes", updatedAt: "now" },
          channels: { value: ["email", "phone"], updatedAt: "now" },
          reason: { value: "Useful context", note: "For the host", updatedAt: "now" },
          hidden: { value: "Retained answer", updatedAt: "now" },
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
    expect(review.textContent).toContain("Yes, please");
    expect(review.textContent).toContain("Email; Phone");
    expect(review.textContent).toContain("Useful context");
    expect(review.textContent).toContain("For the host");
    expect(review.textContent).toContain("Questions hidden by your current answers are not listed here");
    expect(review.textContent).not.toContain("Hidden follow-up");
    expect(review.textContent).not.toContain("Retained answer");
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

  it("locks a stale questionnaire and explains that unsaved edits need a reload", async () => {
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

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { kqa: 1, type: "set", id: "answer", value: "unsaved edit" },
        origin: "null",
        source: frame.contentWindow,
      }));
      await vi.advanceTimersByTimeAsync(650);
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Changes made since the last save were not saved");
    expect(alert?.textContent).toContain("Reload questionnaire");
    const answerSave = state.api.mock.calls.find(([url]) => String(url).endsWith("/answers"));
    expect(answerSave?.[1]).toMatchObject({ body: { version: 7, answers: { answer: { value: "unsaved edit" } } } });
    vi.useRealTimers();
  });
});
