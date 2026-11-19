import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InterviewData, PersonRow } from "../src/components/interview-types";
import { AnswersTab } from "../src/components/AnswersTab";

const manifest = {
  format: "kqa/1" as const,
  title: "Equipment review",
  questions: [{
    id: "assets", type: "repeat" as const, label: "Equipment items", maxRows: 5,
    fields: [
      { id: "asset-name", label: "Asset name", type: "text" as const },
      { id: "condition", label: "Condition", type: "select" as const, options: [{ value: "good", label: "Good condition" }, { value: "poor", label: "Needs repair" }] },
    ],
  }],
};

function interviewData(mode: "single" | "multi", withRetainedGroup = false): InterviewData {
  const people: PersonRow[] = [{
    id: "person-1", token: "private-token", name: "Sam Lee", status: "in_progress" as const, answered: 0, total: 1, requiredMissing: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", answers: {},
    recordGroups: {
      assets: [{ id: "row-opaque-1", values: { "asset-name": "Pump 4", condition: "good" }, revision: 8, fieldRevisions: { "asset-name": 6, condition: 8 } }],
      ...(withRetainedGroup ? { "old-assets": [{ id: "row-old-1", values: { previousName: "Retired item" }, revision: 1, fieldRevisions: {} }] } : {}),
    },
    mail: { state: "unsent" as const, delivery: "unknown" as const },
  }];
  if (mode === "multi") people.push({
    id: "person-2", token: "private-token-2", name: "Alex Kim", status: "invited", answered: 0, total: 1, requiredMissing: 0,
    createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", answers: {}, recordGroups: {},
    mail: { state: "unsent", delivery: "unknown" },
  });
  return {
    interview: { id: "interview", name: "Equipment review", mode, status: "open", currentVersion: 2, createdAt: "2026-01-01T00:00:00.000Z" },
    counts: { people: people.length, invited: mode === "multi" ? 1 : 0, inProgress: 1, submitted: 0 },
    manifest,
    publicOrigin: null,
    versions: [],
    events: [],
    people,
  } as InterviewData;
}

describe("repeat-group host review", () => {
  it("shows ordered record rows with field labels and choice labels in question view", () => {
    const html = renderToStaticMarkup(createElement(AnswersTab, { data: interviewData("multi") }));
    expect(html).toContain("Equipment items");
    expect(html).toContain("row-opaque-1");
    expect(html).toContain("Asset name");
    expect(html).toContain("Pump 4");
    expect(html).toContain("Good condition");
    expect(html).not.toContain("fieldRevisions");
  });

  it("keeps removed-group rows visible by person using raw field IDs", () => {
    const html = renderToStaticMarkup(createElement(AnswersTab, { data: interviewData("single", true) }));
    expect(html).toContain("Retained repeat group");
    expect(html).toContain("old-assets");
    expect(html).toContain("previousName");
    expect(html).toContain("Retired item");
    expect(html).not.toContain("revision");
  });
});
