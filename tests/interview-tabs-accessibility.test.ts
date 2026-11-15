// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterviewView } from "../src/components/InterviewView";
import type { InterviewData } from "../src/components/interview-types";

vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("../src/components/AnswersTab", () => ({ AnswersTab: () => null }));
vi.mock("../src/components/AnalyticsTab", () => ({ AnalyticsTab: () => null }));
vi.mock("../src/components/ExportTab", () => ({ ExportTab: () => null }));
vi.mock("../src/components/InviteActions", () => ({ InviteActions: () => null, PersonEmailEditor: () => null }));
vi.mock("../src/components/PeopleTab", () => ({ PeopleTab: () => null }));
vi.mock("../src/components/SurveyTab", () => ({ SurveyTab: () => null }));
vi.mock("../src/components/ui", () => ({
  api: vi.fn(),
  Badge: () => null,
  CopyButton: () => null,
  Icon: () => null,
  Modal: () => null,
  Spinner: () => null,
  useToast: () => vi.fn(),
}));
vi.mock("../src/lib/time", () => ({ relTime: () => "just now" }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const data = {
  interview: { id: "interview-1", name: "Research interview", mode: "multi", status: "open", currentVersion: 1, createdAt: "2026-01-01T00:00:00.000Z" },
  people: [],
  versions: [],
  events: [],
  manifest: { questions: [], sections: [] },
  publicOrigin: null,
} as unknown as InterviewData;

function renderInterview(initialTab = "overview", analysisOnly = false) {
  act(() => root.render(createElement(InterviewView, { key: initialTab, data, initialTab, analysisOnly })));
}

function tab(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((button) => button.textContent?.includes(name))!;
}

function press(button: HTMLButtonElement, key: string) {
  act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

describe("interview section tabs", () => {
  it("uses roving focus, arrow/Home/End navigation, and a linked tab panel", () => {
    renderInterview();

    const tabs = host.querySelectorAll<HTMLButtonElement>("[role=tab]");
    expect(tabs).toHaveLength(6);
    expect(tab("Overview").tabIndex).toBe(0);
    expect(tab("People").tabIndex).toBe(-1);
    expect(tab("Overview").getAttribute("aria-controls")).toBe("interview-panel");

    const panel = host.querySelector<HTMLElement>("[role=tabpanel]")!;
    expect(panel.id).toBe("interview-panel");
    expect(panel.getAttribute("aria-labelledby")).toBe("interview-tab-overview");

    press(tab("Overview"), "ArrowRight");
    expect(document.activeElement).toBe(tab("People"));
    expect(tab("People").getAttribute("aria-selected")).toBe("true");
    expect(tab("People").tabIndex).toBe(0);
    expect(host.querySelector("[role=tabpanel]")?.getAttribute("aria-labelledby")).toBe("interview-tab-people");

    press(tab("People"), "End");
    expect(document.activeElement).toBe(tab("Export"));
    expect(tab("Export").getAttribute("aria-selected")).toBe("true");

    press(tab("Export"), "ArrowRight");
    expect(document.activeElement).toBe(tab("Overview"));

    press(tab("Overview"), "Home");
    expect(document.activeElement).toBe(tab("Overview"));
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
  });

  it("restores keyboard focus after loading an analysis tab", () => {
    renderInterview();
    press(tab("Answers"), "ArrowRight");
    expect(window.sessionStorage.getItem("kqa:interview:interview-1:tab-focus")).toBe("analysis");

    renderInterview("analysis", true);
    expect(document.activeElement).toBe(tab("Analysis"));
    expect(window.sessionStorage.getItem("kqa:interview:interview-1:tab-focus")).toBeNull();
  });
});
