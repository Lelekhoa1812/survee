// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyTab } from "../src/components/SurveyTab";
import type { InterviewData } from "../src/components/interview-types";
import { summarizeQuestionChanges, summarizeSectionChanges } from "../src/lib/survey-changes";

const state = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("../src/components/ui", () => ({
  api: state.api,
  Badge: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  Icon: () => null,
  Spinner: () => null,
  useToast: () => () => {},
}));

vi.mock("../src/components/Uploader", () => ({
  Uploader: ({ onChange }: { onChange: (upload: { fileName: string; html: string; settled: boolean; ok: boolean }) => void }) => createElement(
    "button",
    { type: "button", onClick: () => onChange({ fileName: "candidate.html", html: "<html></html>", settled: true, ok: true }) },
    "Simulate ready upload",
  ),
}));

vi.mock("../src/components/PreviewFrame", () => ({
  PreviewFrame: () => createElement("div", null, "Questionnaire preview frame"),
}));

const beforeQuestions = [
  { id: "choice", type: "single" as const, label: "Choose", help: "Choose one", options: [{ label: "Old option", value: "a" }, { label: "B", value: "b" }] },
  { id: "score", type: "number" as const, label: "Score", min: 0, max: 100 },
];
const afterQuestions = [
  { id: "choice", type: "single" as const, label: "Choose", help: "Select one", options: [{ label: "New option", value: "a" }, { label: "B", value: "b" }] },
  { id: "score", type: "number" as const, label: "Score", min: 1, max: 10 },
];
const beforeSections = [
  { id: "intro", title: "Introduction", description: "Start here" },
  { id: "end", title: "End" },
];
const afterSections = [
  { id: "end", title: "End" },
  { id: "intro", title: "Getting started", description: "Read this first" },
];
const preview = {
  ok: true as const,
  staticValid: true as const,
  interviewId: "interview-1",
  currentVersion: 2,
  baseHash: "a".repeat(64),
  candidateHash: "b".repeat(64),
  compatibilityHash: "c".repeat(64),
  compatibilityImpact: false,
  previewToken: "signed-preview-token",
  previewExpiresAt: "2026-11-16T00:00:00.000Z",
  diagnostics: [],
  counts: { error: 0, warning: 0, info: 0 },
  report: "",
  changes: {
    questionCountBefore: beforeQuestions.length,
    questionCountAfter: afterQuestions.length,
    questionChanges: summarizeQuestionChanges(beforeQuestions, afterQuestions),
    questionsAfter: afterQuestions,
    sectionsBefore: beforeSections,
    sectionsAfter: afterSections,
    sectionChanges: summarizeSectionChanges(beforeSections, afterSections),
  },
};
const data = {
  interview: { id: "interview-1", name: "Research", mode: "multi", status: "open", currentVersion: 2, createdAt: "2026-11-15T00:00:00.000Z" },
  people: [],
  versions: [{ version: 2, bytes: 100, createdAt: "2026-11-15T00:00:00.000Z", check: { errors: 0, warnings: 0, info: 0 }, questions: 2 }],
  events: [],
  manifest: { format: "kqa/1", title: "Research", questions: beforeQuestions, sections: beforeSections },
  publicOrigin: null,
} as unknown as InterviewData;

let host: HTMLDivElement;
let root: Root;

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label) || item.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset().mockResolvedValue({ ok: true, data: preview });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("host questionnaire version preview", () => {
  it("downloads the currently published source file without changing the live version", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:questionnaire-source");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let downloadedFile = "";
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloadedFile = this.download; });
    state.api.mockResolvedValue({ ok: true, data: { html: "<html>live</html>", fileName: "live.html" } });
    await act(async () => root.render(createElement(SurveyTab, { data, refresh: () => {} })));

    await click("Download current source");

    expect(state.api).toHaveBeenCalledWith("/api/admin/interviews/interview-1/versions?action=restore&restoreVersion=2");
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(downloadedFile).toBe("live.html");
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("downloads a historical source directly without loading it as a candidate", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:previous-questionnaire");
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    state.api.mockResolvedValue({ ok: true, data: { html: "<html>previous</html>", fileName: "previous.html" } });
    const withHistory = { ...data, versions: [data.versions[0], { ...data.versions[0], version: 1, fileName: "previous.html" }] } as unknown as InterviewData;
    await act(async () => root.render(createElement(SurveyTab, { data: withHistory, refresh: () => {} })));

    await click("Download source for version 1");

    expect(state.api).toHaveBeenCalledWith("/api/admin/interviews/interview-1/versions?action=restore&restoreVersion=1");
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(state.api).toHaveBeenCalledTimes(1);
  });

  it("restores a stored version into the candidate preview flow", async () => {
    state.api.mockImplementation(async (_url: string, options?: { method?: string; body?: Record<string, unknown> }) => options?.method === undefined
      ? { ok: true, data: { html: "<html>previous</html>", fileName: "previous.html" } }
      : { ok: true, data: preview });
    const withHistory = { ...data, versions: [data.versions[0], { ...data.versions[0], version: 1, fileName: "previous.html" }] } as unknown as InterviewData;
    await act(async () => root.render(createElement(SurveyTab, { data: withHistory, refresh: () => {} })));

    await click("Restore as candidate");
    expect(host.textContent).toContain("previous.html");
    await click("Preview candidate changes");

    expect(state.api).toHaveBeenLastCalledWith("/api/admin/interviews/interview-1/versions", { method: "POST", body: { action: "preview", html: "<html>previous</html>", fileName: "previous.html" } });
    expect(host.textContent).toContain("Make this version live");
  });

  it("shows checker warning details in the candidate review", async () => {
    state.api.mockResolvedValueOnce({ ok: true, data: {
      ...preview,
      diagnostics: [{ code: "KQA608", severity: "warning", category: "runtime", title: "Custom control did not react", message: "Saved values may appear blank when respondents return.", fix: "Update the control to repaint from KQA.get()." }],
      counts: { error: 0, warning: 1, info: 0 },
    } });
    await act(async () => root.render(createElement(SurveyTab, { data, refresh: () => {} })));
    await click("Upload a new version");
    await click("Simulate ready upload");
    await click("Preview candidate changes");

    expect(host.textContent).toContain("Review checker findings before publishing");
    expect(host.textContent).toContain("Saved values may appear blank when respondents return.");
    expect(host.textContent).toContain("Update the control to repaint from KQA.get().");
  });

  it("preserves an active candidate until the host cancels before restoring history", async () => {
    state.api.mockImplementation(async (_url: string, options?: { method?: string; body?: Record<string, unknown> }) => options?.method === undefined
      ? { ok: true, data: { html: "<html>previous</html>", fileName: "previous.html" } }
      : { ok: true, data: preview });
    const withHistory = { ...data, versions: [data.versions[0], { ...data.versions[0], version: 1, fileName: "previous.html" }] } as unknown as InterviewData;
    await act(async () => root.render(createElement(SurveyTab, { data: withHistory, refresh: () => {} })));
    await click("Upload a new version");
    await click("Simulate ready upload");

    const restore = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Restore as candidate"));
    expect(restore?.disabled).toBe(true);
    expect(restore?.getAttribute("title")).toContain("Cancel the current candidate");
    expect(state.api).not.toHaveBeenCalled();

    await click("Cancel");
    await click("Restore as candidate");
    expect(host.textContent).toContain("previous.html");
  });

  it("keeps the survey visible to members without exposing publishing controls", async () => {
    await act(async () => root.render(createElement(SurveyTab, { data, refresh: () => {}, canManage: false })));

    expect(host.textContent).toContain("Current live preview");
    expect(host.textContent).toContain("Version history");
    expect(host.textContent).not.toContain("Upload a new version");
    expect(host.textContent).not.toContain("Download source");
    expect(host.textContent).not.toContain("Make this version live");
  });

  it("labels the existing-answer count as a first-page count", async () => {
    const withFirstPage = { ...data, people: [{ answered: 3 }] } as unknown as InterviewData;
    await act(async () => root.render(createElement(SurveyTab, { data: withFirstPage, refresh: () => {} })));
    await click("Upload a new version");

    expect(host.textContent).toContain("The 1 person on the first page has 3 saved answers represented here.");
  });

  it("shows exact option, help, numeric-bound, section-edit, and section-order changes before publish", async () => {
    await act(async () => root.render(createElement(SurveyTab, { data, refresh: () => {} })));
    await click("Upload a new version");
    await click("Simulate ready upload");
    await click("Preview candidate changes");

    const text = host.textContent ?? "";
    expect(text).toContain("Old option (value: a); B (value: b)");
    expect(text).toContain("New option (value: a); B (value: b)");
    expect(text).toContain("Choose one");
    expect(text).toContain("Select one");
    expect(text).toContain("Before");
    expect(text).toContain("Candidate");
    expect(text).toContain("0");
    expect(text).toContain("100");
    expect(text).toContain("1");
    expect(text).toContain("10");
    expect(text).toContain("Introduction");
    expect(text).toContain("Getting started");
    expect(text).toContain("Start here");
    expect(text).toContain("Read this first");
    expect(text).toContain("Moved section intro: position 1 → 2");
  });
});
