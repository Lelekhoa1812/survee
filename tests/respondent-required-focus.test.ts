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
});
