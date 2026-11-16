// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsTab } from "../src/components/AnalyticsTab";
import { ANALYTICS_COHORTS } from "../src/lib/analytics/cohorts";
import { summarizeQuestion } from "../src/lib/analytics/summary";
import type { InterviewData } from "../src/components/interview-types";
import type { AnswerMap, Question } from "../src/lib/format/schema";
import type { ParticipantStatus } from "../src/lib/repo/types";

const at = "2026-11-15T00:00:00.000Z";
const region: Question = {
  id: "region",
  type: "single",
  label: "Region",
  options: [{ value: "north", label: "North" }, { value: "south", label: "South" }],
};
const department: Question = {
  id: "department",
  type: "select",
  label: "Department",
  options: [{ value: "ops", label: "Operations" }, { value: "eng", label: "Engineering" }],
};
const satisfaction: Question = {
  id: "satisfaction",
  type: "single",
  label: "Satisfaction",
  options: [{ value: "agree", label: "Agree" }, { value: "disagree", label: "Disagree" }],
};
const budget: Question = { id: "budget", type: "number", label: "Budget", min: 0, max: 100 };
const questions = [region, department, satisfaction, budget];
function answer(value: string | number) {
  return { value, updatedAt: at };
}
const rows: { status: ParticipantStatus; answers: AnswerMap }[] = [
  { status: "invited", answers: { region: answer("north"), department: answer("ops"), budget: answer(10) } },
  { status: "in_progress", answers: { region: answer("south"), department: answer("eng"), satisfaction: answer("disagree"), budget: answer(20) } },
  { status: "submitted", answers: { region: answer("north"), department: answer("eng"), satisfaction: answer("agree"), budget: answer(30) } },
];

function buildAnalysis() {
  const summaries = Object.fromEntries(ANALYTICS_COHORTS.map((cohort) => [
    cohort.key,
    Object.fromEntries(questions.map((question) => [
      question.id,
      summarizeQuestion(question, rows.filter((row) => cohort.statuses.some((status) => status === row.status))),
    ])),
  ]));
  return {
    asOf: "2026-11-15T00:00:00.000Z",
    statusCounts: { invited: 1, in_progress: 1, submitted: 1 },
    summaries,
  };
}

const data = {
  interview: { id: "interview-1", name: "Research interview", mode: "multi", status: "open", currentVersion: 1, createdAt: "2026-01-01T00:00:00.000Z" },
  people: [],
  versions: [],
  events: [],
  manifest: { questions, sections: [] },
  publicOrigin: null,
  analysis: buildAnalysis(),
} as unknown as InterviewData;

function segmentResponse(url: URL) {
  const dimension = questions.find((question) => question.id === url.searchParams.get("segmentBy"))!;
  const outcomes = url.searchParams.getAll("questionId").map((id) => questions.find((question) => question.id === id)!);
  const statuses = (url.searchParams.get("statuses") ?? "").split(",") as ParticipantStatus[];
  const dimensionOptions = dimension.options ?? [];
  const segments = dimensionOptions.map((option) => {
    const members = rows.filter((row) => statuses.includes(row.status) && row.answers[dimension.id]?.value === option.value);
    const summaries = Object.fromEntries(outcomes.map((outcome) => [outcome.id, summarizeQuestion(outcome, members)]));
    return {
      key: `answer:${option.value}`,
      kind: "answer",
      value: option.value,
      label: option.label,
      participantCount: members.length,
      disclosureRisk: {
        singletonSegment: members.length === 1,
        singletonStatusGroups: url.searchParams.get("compareStatuses") === "true"
          ? statuses.filter((status) => members.filter((row) => row.status === status).length === 1)
          : [],
      },
      statusCounts: {
        invited: members.filter((row) => row.status === "invited").length,
        in_progress: members.filter((row) => row.status === "in_progress").length,
        submitted: members.filter((row) => row.status === "submitted").length,
      },
      summaries,
      statusSummaries: Object.fromEntries(statuses.map((status) => [status, Object.fromEntries(outcomes.map((outcome) => [
        outcome.id,
        summarizeQuestion(outcome, members.filter((row) => row.status === status)),
      ]))])),
    };
  });
  const statusCounts = { invited: 1, in_progress: 1, submitted: 1 };
  return {
    ok: true,
    interviewId: "interview-1",
    surveyVersion: responseSurveyVersion,
    asOf: "2026-11-15T00:01:00.000Z",
    segmentBy: { id: dimension.id, type: dimension.type, label: dimension.label },
    outcomes: outcomes.map((outcome) => ({ id: outcome.id, type: outcome.type, label: outcome.label })),
    scope: { statuses, participantCount: statuses.length, statusCounts, compareStatuses: url.searchParams.get("compareStatuses") === "true" },
    segments,
    methodology: [],
  };
}

function crossTabResponse(url: URL) {
  const rowQuestion = questions.find((question) => question.id === url.searchParams.get("segmentBy"))!;
  const columnQuestion = questions.find((question) => question.id === url.searchParams.get("crossTabWith"))!;
  const statuses = (url.searchParams.get("statuses") ?? "").split(",") as ParticipantStatus[];
  const rowValues = (rowQuestion.options ?? []).map((option) => ({ key: `answer:${option.value}`, kind: "answer", value: option.value, label: option.label }));
  const columnValues = (columnQuestion.options ?? []).map((option) => ({ key: `answer:${option.value}`, kind: "answer", value: option.value, label: option.label }));
  const counts = (dimension: Question, value: string) => rows.filter((row) => statuses.includes(row.status) && row.answers[dimension.id]?.value === value);
  const rowGroups = rowValues.map((item) => ({
    ...item,
    participantCount: counts(rowQuestion, item.value!).length,
    statusCounts: Object.fromEntries((["invited", "in_progress", "submitted"] as ParticipantStatus[]).map((status) => [status, counts(rowQuestion, item.value!).filter((row) => row.status === status).length])),
  }));
  const columnGroups = columnValues.map((item) => ({
    ...item,
    participantCount: counts(columnQuestion, item.value!).length,
    statusCounts: Object.fromEntries((["invited", "in_progress", "submitted"] as ParticipantStatus[]).map((status) => [status, counts(columnQuestion, item.value!).filter((row) => row.status === status).length])),
  }));
  const cells = rowGroups.flatMap((row) => columnGroups.map((column) => {
    const members = rows.filter((person) => statuses.includes(person.status)
      && person.answers[rowQuestion.id]?.value === row.value
      && person.answers[columnQuestion.id]?.value === column.value);
    const statusCounts = Object.fromEntries((["invited", "in_progress", "submitted"] as ParticipantStatus[]).map((status) => [status, members.filter((person) => person.status === status).length]));
    return {
      rowKey: row.key,
      columnKey: column.key,
      participantCount: members.length,
      rowDenominator: row.participantCount,
      rowPercent: row.participantCount ? members.length / row.participantCount * 100 : null,
      statusCounts,
      disclosureRisk: { singletonSegment: members.length === 1, singletonStatusGroups: [] },
    };
  }));
  const statusCounts = { invited: 1, in_progress: 1, submitted: 1 };
  return {
    ok: true,
    interviewId: "interview-1",
    surveyVersion: responseSurveyVersion,
    asOf: "2026-11-15T00:01:00.000Z",
    rowBy: { id: rowQuestion.id, type: rowQuestion.type, label: rowQuestion.label },
    columnBy: { id: columnQuestion.id, type: columnQuestion.type, label: columnQuestion.label },
    scope: { statuses, participantCount: statuses.length, statusCounts },
    rows: rowGroups,
    columns: columnGroups,
    cells,
    overlapping: rowQuestion.type === "multi" || columnQuestion.type === "multi",
    methodology: [],
  };
}

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let copied: string[];
let deferFetch = false;
let deferredRequest: { url: URL; resolve: (response: Response) => void } | null = null;
let responseSurveyVersion = 1;

function responseFor(url: URL) {
  return new Response(JSON.stringify(url.searchParams.has("crossTabWith") ? crossTabResponse(url) : segmentResponse(url)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  copied = [];
  deferFetch = false;
  deferredRequest = null;
  responseSurveyVersion = 1;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (text: string) => { copied.push(text); }) },
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.href);
    if (deferFetch) {
      deferFetch = false;
      return await new Promise<Response>((resolve) => { deferredRequest = { url, resolve }; });
    }
    return responseFor(url);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickInput(input: HTMLInputElement) {
  await act(async () => {
    input.click();
    await Promise.resolve();
  });
}

async function change(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function resolveDeferredRequest() {
  const pending = deferredRequest;
  if (!pending) throw new Error("Expected a deferred analytics request.");
  deferredRequest = null;
  await act(async () => {
    pending.resolve(responseFor(pending.url));
    await Promise.resolve();
  });
}

describe("answer-segment analytics UI", () => {
  it("renders and exports a two-question count matrix", async () => {
    await act(async () => root.render(createElement(AnalyticsTab, { data })));
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Cross-tab answers")!);

    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("crossTabWith=department");
    expect(host.querySelector(".analysis-cross-tab-table")?.textContent).toContain("Region ↓ / Department →");
    expect(host.querySelector(".analysis-cross-tab-table")?.textContent).toContain("Operations");
    expect(host.querySelector(".analysis-cross-tab-table")?.textContent).toContain("1 (50%)");
    expect(host.querySelector(".analysis-cross-tab-table")?.textContent).toContain("1 person");

    await change(host.querySelector<HTMLSelectElement>("#analysis-cross-tab-column")!, "satisfaction");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("crossTabWith=satisfaction");
    expect(host.querySelector(".analysis-cross-tab-table")?.textContent).toContain("Satisfaction");

    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Copy CSV")!);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('"row_question","row_answer","column_question","column_answer"');
    expect(copied[0]).toContain('"Region","North","Satisfaction","Agree"');
    expect(copied[0]).toContain("No minimum group threshold or anonymity guarantee");
  });

  it("updates loaded dimension and outcome results, compares statuses, and copies the refreshed CSV", async () => {
    await act(async () => root.render(createElement(AnalyticsTab, { data })));
    expect(host.querySelector(".analysis-disclosure-flag")?.textContent).toContain("South count=1");

    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Break down by answer")!);
    expect(host.querySelector(".analysis-segment-list")?.getAttribute("aria-label")).toBe("Results grouped by Region");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("segmentBy=region");

    await change(host.querySelector<HTMLSelectElement>("#analysis-segment-by")!, "department");
    expect(host.textContent).toContain("Operations");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("segmentBy=department");
    expect(host.querySelector(".analysis-segment-result-head")?.textContent).toContain("Region");
    expect(host.querySelector(".analysis-disclosure-note")?.textContent).toContain("does not apply a minimum size");
    expect(host.querySelector(".analysis-disclosure-flag")?.textContent).toContain("Singleton group");

    await clickInput(host.querySelector<HTMLInputElement>('[data-question-id="satisfaction"]')!);
    await clickInput(host.querySelector<HTMLInputElement>('[data-question-id="budget"]')!);
    expect(host.querySelector(".analysis-segment-result-head")?.textContent).toContain("3 outcome questions");
    expect(host.textContent).toContain("Satisfaction");
    expect(host.textContent).toContain("Budget");
    expect(host.textContent).toContain("Agree");
    expect(host.textContent).toContain("0 answered · 1 no answer · cohort n=1");
    expect(new URL(String(fetchMock.mock.calls.at(-1)?.[0]), window.location.href).searchParams.getAll("questionId")).toEqual(["region", "satisfaction", "budget"]);

    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Compare statuses")!);
    expect(host.textContent).toContain("Invited 1 · In progress 0 · Submitted 0");
    expect(host.textContent).toContain("Invited · not started: 0 answered, 1 no answer");
    expect(host.textContent).toContain("One-person status group");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("compareStatuses=true");

    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Copy CSV")!);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('"satisfaction","Satisfaction","single","Department = Operations · Invited · not started"');
    expect(copied[0]).toContain('"budget","Budget","number","Department = Operations · Invited · not started"');
    expect(copied[0]).toContain('"region","Region","single","Department = Operations · Invited · not started"');
    expect(copied[0]).toContain('"interview-1","1","2026-11-15T00:01:00.000Z"');
    expect(copied[0]).toContain('"true","invited",');
    expect(copied[0]).toContain("Singleton signals cover counts of one only");
  });

  it("hides and disables stale results while compare and cohort scopes are loading", async () => {
    await act(async () => root.render(createElement(AnalyticsTab, { data })));
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Break down by answer")!);
    expect(host.querySelector(".analysis-segment-list")).not.toBeNull();

    deferFetch = true;
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Compare statuses")!);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("compareStatuses=true");
    expect(host.querySelector(".analysis-segment-list")).toBeNull();
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Copy CSV")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".analysis-export-actions button:last-child")?.disabled).toBe(true);
    await resolveDeferredRequest();
    expect(host.querySelector(".analysis-segment-list")).not.toBeNull();

    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "One cohort")!);
    expect(host.querySelector(".analysis-segment-list")).not.toBeNull();
    const invited = host.querySelector<HTMLInputElement>(".analysis-cohort-options input")!;
    deferFetch = true;
    await act(async () => {
      invited.click();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("statuses=in_progress%2Csubmitted");
    expect(host.querySelector(".analysis-segment-list")).toBeNull();
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Copy CSV")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".analysis-export-actions button:last-child")?.disabled).toBe(true);
    await resolveDeferredRequest();
    expect(host.querySelector(".analysis-segment-list")).not.toBeNull();
  });

  it("rejects a segment response from a different survey version", async () => {
    responseSurveyVersion = 2;
    await act(async () => root.render(createElement(AnalyticsTab, { data })));

    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Break down by answer")!);

    expect(new URL(String(fetchMock.mock.calls.at(-1)?.[0]), window.location.href).searchParams.get("surveyVersion")).toBe("1");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("survey changed while analysis loaded");
    expect(host.querySelector(".analysis-segment-list")).toBeNull();
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Copy CSV")?.disabled).toBe(true);
  });
});
