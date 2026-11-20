// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PeopleTab } from "../src/components/PeopleTab";
import type { InterviewData } from "../src/components/interview-types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function dataFor(mode: "single" | "multi"): InterviewData {
  return {
    interview: { id: "interview-1", name: "Research", mode, status: "open", currentVersion: 1, createdAt: "2026-11-14T00:00:00.000Z" },
    people: [],
    versions: [],
    events: [],
    manifest: { format: "kqa/1", title: "Research", questions: [] },
    publicOrigin: "https://kqa.example",
  } as unknown as InterviewData;
}

function openAddPeople() {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add people"))!;
  act(() => button.click());
}

describe("Add people on a One-person interview", () => {
  it("explains that adding people switches the interview to Multi-user", () => {
    act(() => root.render(createElement(PeopleTab, { data: dataFor("single"), origin: "https://kqa.example", refresh: () => {} })));
    openAddPeople();

    expect(document.body.textContent).toContain("This is a One-person interview. Adding people switches it to Multi-user.");
    expect(document.body.textContent).toContain("The existing link and its answers stay as they are.");
  });

  it("does not show the switch notice on a Multi-user interview", () => {
    act(() => root.render(createElement(PeopleTab, { data: dataFor("multi"), origin: "https://kqa.example", refresh: () => {} })));
    openAddPeople();

    expect(document.body.textContent).toContain("Add people");
    expect(document.body.textContent).not.toContain("switches it to Multi-user");
  });
});
