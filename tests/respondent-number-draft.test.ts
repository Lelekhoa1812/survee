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
  state.api.mockReset().mockResolvedValue({ ok: true, status: 200, data: {
    participant: { name: "Ada", status: "in_progress" }, interview: { name: "Study", status: "open" }, version: 7, title: "Study",
    questions: [
      { id: "amount", type: "number", label: "Amount" },
      { id: "note", type: "text", label: "Note" },
    ],
    answers: { amount: { value: 5, updatedAt: "2026-11-16T00:00:00.000Z" } },
  } });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("scalar browser-invalid number drafts in the respondent shell", () => {
  it("blocks review, submission and unload while a number draft is invalid, and releases them after correction", async () => {
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const send = (data: object) => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, ...data }, origin: "null", source: frame.contentWindow }));
    const review = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Review answers")!;
    expect(review().disabled).toBe(false);

    await act(async () => send({ type: "number-draft", id: "amount", valid: false }));
    expect(review().disabled).toBe(true);
    expect(host.querySelector(".rs-banner.warn")?.textContent).toContain("This value is invalid and has not been saved. Check this field.");
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    await act(async () => send({ type: "number-draft", id: "amount", valid: true }));
    expect(review().disabled).toBe(false);
    expect(host.querySelector(".rs-banner.warn")).toBeNull();
    const safe = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(safe);
    expect(safe.defaultPrevented).toBe(false);
  });

  it("keeps answer edits and marks them unsaved when autosave is rejected for request size", async () => {
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const send = (data: object) => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, ...data }, origin: "null", source: frame.contentWindow }));
    const outbound = vi.spyOn(frame.contentWindow!, "postMessage");
    vi.useFakeTimers();
    state.api.mockResolvedValueOnce({ ok: false, status: 413, data: { code: "payload_too_large" } });
    await act(async () => send({ type: "hello" }));
    outbound.mockClear();

    await act(async () => send({ type: "set", id: "note", value: "This edit must remain available" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });

    expect(state.api).toHaveBeenCalledTimes(2); // initial load and rejected PUT; no reconciliation GET
    expect(host.querySelector(".rs-save-label")?.textContent).toBe("Not saved");
    expect(outbound.mock.calls.some(([message]) => (message as { type?: string }).type === "answers")).toBe(false);
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    outbound.mockRestore();
  });

  it("ignores number-draft messages for questions that are not number questions", async () => {
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const frame = host.querySelector("iframe")!;
    const send = (data: object) => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, ...data }, origin: "null", source: frame.contentWindow }));
    await act(async () => send({ type: "number-draft", id: "note", valid: false }));
    await act(async () => send({ type: "number-draft", id: "missing", valid: false }));
    const review = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Review answers")!;
    expect(review.disabled).toBe(false);
  });
});
