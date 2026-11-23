import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportTab } from "../src/components/ExportTab";
import type { InterviewData } from "../src/components/interview-types";

const base = {
  interview: { id: "interview-1", name: "Research", mode: "multi", status: "open", currentVersion: 2, createdAt: "2026-11-14T00:00:00.000Z" },
  counts: { people: 60, invited: 10, inProgress: 15, submitted: 35 },
  people: [], versions: [], events: [], manifest: { format: "kqa/1", title: "Research", questions: [] }, publicOrigin: null,
} as unknown as InterviewData;

describe("export availability", () => {
  it("uses aggregate counts rather than the loaded participant page", () => {
    const html = renderToStaticMarkup(createElement(ExportTab, { data: base }));

    expect(html).toContain("include all 60 people");
    expect(html).toContain("35 submitted, 25 still in progress or not started");
    expect(html).toContain("/api/admin/interviews/interview-1/export?format=xlsx");
  });

  it("disables full downloads above the supported limit instead of offering a broken link", () => {
    const data = { ...base, counts: { ...base.counts, people: 120, submitted: 70 } } as InterviewData;
    const html = renderToStaticMarkup(createElement(ExportTab, { data }));

    expect(html).toContain("include all 120 people");
    expect(html).toContain("Full exports currently support up to 100 people");
    expect(html).toContain("Export limit reached");
    expect(html).not.toContain("/api/admin/interviews/interview-1/export?format=xlsx");
  });
});
