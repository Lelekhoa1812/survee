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
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
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
});

describe("host questionnaire version preview", () => {
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
