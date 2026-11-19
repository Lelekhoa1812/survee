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
});
