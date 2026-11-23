// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterviewView } from "../src/components/InterviewView";
import type { InterviewData } from "../src/components/interview-types";

const routerState = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => routerState }));
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
  routerState.push.mockClear();
  routerState.refresh.mockClear();
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
  counts: { people: 0, invited: 0, inProgress: 0, submitted: 0 },
  people: [],
  versions: [],
  events: [],
  manifest: { questions: [], sections: [] },
  publicOrigin: null,
} as unknown as InterviewData;

function renderInterview(initialTab = "overview", analysisOnly = false, canManage = true, answersIncluded = false) {
  act(() => root.render(createElement(InterviewView, { key: initialTab, data: { ...data, answersIncluded }, initialTab, analysisOnly, canManage })));
}

function tab(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((button) => button.textContent?.includes(name))!;
}

function press(button: HTMLButtonElement, key: string) {
  act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

describe("interview section tabs", () => {
  it("loads the Answers tab with answer data only after selection", () => {
    renderInterview();
    act(() => tab("Answers").click());

    expect(routerState.push).toHaveBeenCalledWith(expect.stringContaining("tab=answers"));
  });

  it("switches directly when answer details are already loaded", () => {
    renderInterview("overview", false, true, true);
    act(() => tab("Answers").click());

    expect(routerState.push).not.toHaveBeenCalled();
    expect(tab("Answers").getAttribute("aria-selected")).toBe("true");
  });

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

  it("limits members to interview overview, aggregate analysis, and read-only survey", () => {
    renderInterview("overview", false, false);

    expect([...host.querySelectorAll("[role=tab]")].map((button) => button.textContent?.trim())).toEqual(["Overview", "Analysis", "Survey"]);
    expect(host.textContent).not.toContain("Edit details");
    expect(host.textContent).not.toContain("Close interview");
    expect(host.textContent).not.toContain("Delete this interview");
    expect(host.textContent).not.toContain("Add people");
    expect(host.textContent).not.toContain("Refresh progress");
    expect(host.textContent).toContain("Member access: interview setup and aggregate analysis only.");
  });

  it("lets an interview manager refresh the live status snapshot", () => {
    renderInterview();
    const refresh = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Refresh progress"))!;
    expect(refresh.type).toBe("button");
    act(() => refresh.click());
    expect(routerState.refresh).toHaveBeenCalledOnce();
  });
});
