import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../src/app/admin/(shell)/page";
import { listInterviews } from "@/lib/repo";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/lib/repo", () => ({ listInterviews: vi.fn() }));
vi.mock("@/lib/http", () => ({ adminSession: async () => ({ role: "admin" }) }));

describe("empty dashboard quickstart", () => {
  beforeEach(() => vi.mocked(listInterviews).mockReset());

  it("guides a new host through the existing file, checker, and create workflow", async () => {
    vi.mocked(listInterviews).mockResolvedValue([]);
    const html = renderToStaticMarkup(await Dashboard());

    expect(html).toContain("Start with a questionnaire file");
    expect(html).toContain("href=\"/admin/docs\" class=\"btn sm first-run-action\">Format guide and AI agent bundle</a>");
    expect(html).toMatch(/<a class=\"first-run-text-link\" href=\"\/api\/docs\/template\/starter\.kqa\.html\" download(?:=\"\")?>Download starter template<\/a>/);
    expect(html).toContain("href=\"/admin/check\" class=\"btn sm first-run-action\">Check a file</a>");
    expect(html).toContain("href=\"/admin/new\" class=\"btn primary first-run-action\">");
    expect((html.match(/<li class=\"first-run-step\">/g) ?? [])).toHaveLength(3);
    expect(html).not.toContain("New interview</a>");
  });

  it("keeps the quickstart out of an established dashboard", async () => {
    vi.mocked(listInterviews).mockResolvedValue([{
      id: "interview-1",
      name: "Research interview",
      mode: "single",
      status: "open",
      currentVersion: 1,
      createdAt: "2026-11-15T00:00:00.000Z",
      updatedAt: "2026-11-15T00:00:00.000Z",
      counts: { people: 1, invited: 1, inProgress: 0, submitted: 0 },
    }]);
    const html = renderToStaticMarkup(await Dashboard());

    expect(html).toContain("New interview</a>");
    expect(html).toContain("Research interview");
    expect(html).not.toContain("Start with a questionnaire file");
  });
});
