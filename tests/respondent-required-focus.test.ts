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
  it("returns focus to the first missing question after the warning closes", async () => {
    await act(async () => {
      root.render(createElement(RespondentShell, { token: "participant-token" }));
      await Promise.resolve();
    });

    const submit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Submit"))!;
    const frame = host.querySelector("iframe")!;
    const postMessage = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: postMessage });
    submit.focus();
    await act(async () => submit.click());

    const goBack = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Go back and answer"))!;
    await act(async () => goBack.click());

    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(submit);
    expect(postMessage).toHaveBeenCalledWith({ kqa: 1, type: "focus-question", id: "first-required" }, "*");
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
