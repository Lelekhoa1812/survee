// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RespondentShell } from "../src/components/RespondentShell";

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
    presentation: "guided",
    sections: [{ id: "about", title: "About you" }, { id: "goals", title: "Your goals" }],
    questions: [
      { id: "name", type: "text", section: "about", label: "Your name" },
      { id: "goal", type: "text", section: "goals", label: "Your goal", required: true },
    ],
    answers: {},
    progress: { eligible: { name: true, goal: true } },
  } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("guided respondent sections", () => {
  it("moves between sections, validates on Continue and retains an all-questions escape", async () => {
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const iframe = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "hello" }, origin: "null", source: iframe.contentWindow })));
    expect(host.querySelector(".rs-guided-step")?.textContent).toContain("About you");

    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Continue")!.click());
    expect(host.querySelector(".rs-guided-step")?.textContent).toContain("Your goals");

    await act(async () => host.querySelector<HTMLButtonElement>(".rs-guided-actions .btn.accent")!.click());
    expect(host.querySelector(".rs-guided-error")?.textContent).toContain("Your goal");
    expect(host.querySelector("[role=dialog]")).toBeNull();

    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Back")!.click());
    expect(host.querySelector(".rs-guided-step")?.textContent).toContain("About you");
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Show all questions")!.click());
    expect(host.querySelector(".rs-guided")).toBeNull();
  });

  it("offers answer review when routing leaves no eligible sections", async () => {
    state.api.mockResolvedValueOnce({ ok: true, status: 200, data: {
      ok: true,
      participant: { name: "Ada", status: "in_progress" },
      interview: { name: "Study", status: "open" },
      version: 1,
      title: "Study questions",
      presentation: "guided",
      sections: [{ id: "next", title: "Next step" }],
      questions: [{ id: "next-question", type: "text", section: "next", label: "Next question" }],
      answers: {},
      progress: { eligible: { "next-question": false } },
    } });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    expect(host.querySelector(".rs-guided-empty")?.textContent).toContain("no sections to complete");
    await act(async () => host.querySelector<HTMLButtonElement>(".rs-guided-empty .btn")!.click());
    expect(host.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("blocks guided Continue for a partial non-empty minimum checkbox answer", async () => {
    state.api.mockResolvedValueOnce({ ok: true, status: 200, data: {
      ok: true,
      participant: { name: "Ada", status: "in_progress" },
      interview: { name: "Study", status: "open" },
      version: 1,
      title: "Study questions",
      presentation: "guided",
      sections: [{ id: "about", title: "About you" }, { id: "goals", title: "Your goals" }],
      questions: [
        { id: "channels", type: "multi", section: "about", label: "Which channels?", minSelections: 2, options: [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "web", label: "Web" }] },
        { id: "goal", type: "text", section: "goals", label: "Your goal" },
      ],
      answers: { channels: { value: ["email"], updatedAt: "now" } },
      progress: { eligible: { channels: true, goal: true } },
    } });
    await act(async () => { root.render(createElement(RespondentShell, { token: "participant-token" })); await Promise.resolve(); });
    const iframe = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "hello" }, origin: "null", source: iframe.contentWindow })));

    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Continue")!.click());
    expect(host.querySelector(".rs-guided-step")?.textContent).toContain("About you");
    expect(host.querySelector(".rs-guided-error")?.textContent).toContain("Choose at least 2 options, or leave this question blank.");
  });
});
