import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeopleTab } from "../src/components/PeopleTab";
import type { InterviewData, PersonRow } from "../src/components/interview-types";

const person: PersonRow = {
  id: "person-1",
  token: "private-token",
  name: "Riley Chen",
  email: "riley@example.com",
  note: "Follow up next week",
  mail: { state: "sent", sentAt: "2026-11-15T00:00:00.000Z", delivery: "delivered" },
  status: "submitted",
  answered: 5,
  total: 5,
  requiredMissing: 0,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  lastSavedAt: "2026-11-15T00:00:00.000Z",
  submittedAt: "2026-11-15T00:00:00.000Z",
  answers: {},
};

const data = {
  interview: { id: "interview-1", name: "Research", mode: "multi", status: "open", currentVersion: 1, createdAt: "2026-11-14T00:00:00.000Z" },
  people: [person],
  versions: [],
  events: [],
  manifest: { format: "kqa/1", title: "Research", questions: [] },
  publicOrigin: "https://kqa.example",
} as unknown as InterviewData;

describe("respondent list", () => {
  it("prioritizes identity, response progress, and invite delivery while grouping secondary actions", () => {
    const html = renderToStaticMarkup(createElement(PeopleTab, { data, origin: "https://kqa.example", refresh: () => {} }));

    expect(html.match(/<th(?=[\s>])/g)).toHaveLength(4);
    expect(html).toContain("Respondent status, invitation delivery, and actions");
    expect(html).toContain("Riley Chen");
    expect(html).toContain("riley@example.com");
    expect(html).toContain("Submitted");
    expect(html).toContain("5 of 5 answered");
    expect(html).toContain("Delivered");
    expect(html).toContain('<details class="person-more-actions">');
    expect(html).toContain("Copy private link");
    expect(html).toContain("Open as respondent");
    expect(html).toContain("Reopen answers");
    expect(html).toContain("Replace private link");
    expect(html).toContain("The old link stops working.");
    expect(html).toContain('class="btn sm danger"');
    expect(html).not.toContain("<code");
  });

  it("offers Add people on a One-person interview", () => {
    const single = { ...data, interview: { ...data.interview, mode: "single" } } as InterviewData;
    const html = renderToStaticMarkup(createElement(PeopleTab, { data: single, origin: "https://kqa.example", refresh: () => {} }));

    expect(html).toContain("Add people");
    expect(html).not.toContain("Remove person");
  });
});
