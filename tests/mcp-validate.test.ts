import { beforeEach, describe, expect, it, vi } from "vitest";

const { noteMcp, listInterviews, recentEvents } = vi.hoisted(() => ({
  noteMcp: vi.fn(async () => {}),
  listInterviews: vi.fn(async () => []),
  recentEvents: vi.fn(async () => []),
}));

vi.mock("../src/lib/db", () => ({
  db: async () => { throw new Error("db() should not run in this test"); },
  col: {},
}));

vi.mock("../src/lib/repo", () => ({
  noteMcp,
  listInterviews,
  recentEvents,
  getInterview: vi.fn(async () => ({ _id: { toHexString: () => "a".repeat(24) }, currentVersion: 2, name: "Probe", description: "", mode: "multi", status: "open", createdAt: new Date(), updatedAt: new Date() })),
  getVersion: vi.fn(async (_id: unknown, version: number) => (version === 2 ? { version: 2, fileName: "a.html", html: "<p></p>", manifest: { questions: [] } } : null)),
}));

import { dispatchTool, listToolDefs } from "../src/lib/mcp/tools";
import { validateToolArgs } from "../src/lib/mcp/validate";
import { LIMITS } from "../src/lib/format/schema";

describe("tool argument schema", () => {
  beforeEach(() => {
    noteMcp.mockClear();
    listInterviews.mockClear();
    recentEvents.mockClear();
  });

  it("rejects unknown fields, a string version, and a limit below 1", async () => {
    const extra = await dispatchTool("list_interviews", { nope: true });
    const version = await dispatchTool("get_survey_html", { interviewId: "a".repeat(24), version: "1" });
    const fraction = await dispatchTool("get_survey_html", { interviewId: "a".repeat(24), version: 1.5 });
    const zero = await dispatchTool("list_events", { interviewId: "a".repeat(24), limit: 0 });
    for (const result of [extra, version, fraction, zero]) expect(result.isError).toBe(true);
    expect(extra.structuredContent.error).toMatch(/Unknown field/);
    expect(version.structuredContent.error).toMatch(/integer/);
    expect(zero.structuredContent.error).toMatch(/at least 1/);
    expect(listInterviews).not.toHaveBeenCalled();
    expect(recentEvents).not.toHaveBeenCalled();
    expect(noteMcp).toHaveBeenCalledTimes(4);
  });

  it("allows an omitted version and an omitted limit", async () => {
    const html = await dispatchTool("get_survey_html", { interviewId: "a".repeat(24) });
    const events = await dispatchTool("list_events", { interviewId: "a".repeat(24) });
    expect(html.isError).toBe(false);
    expect(html.structuredContent.version).toBe(2);
    expect(events.isError).toBe(false);
    expect(recentEvents).toHaveBeenCalledWith("a".repeat(24), 30);
  });

  it("reports a missing required field from the schema", () => {
    expect(validateToolArgs({ type: "object", properties: { interviewId: { type: "string" } }, required: ["interviewId"], additionalProperties: false }, {})).toMatch(/interviewId is required/);
  });

  it("rejects strings beyond a schema length limit", () => {
    expect(validateToolArgs({ type: "string", maxLength: 3 }, "token")).toMatch(/at most 3 characters/);
  });

  it("validates nullable schema alternatives", () => {
    const section = { anyOf: [{ type: "string" }, { type: "null" }] };
    expect(validateToolArgs(section, "writing")).toBeNull();
    expect(validateToolArgs(section, null)).toBeNull();
    expect(validateToolArgs(section, 12)).toMatch(/match one of the allowed types/);
  });

  it("advertises and validates block patch batches up to the questionnaire question limit", () => {
    const tool = listToolDefs().find(({ name }) => name === "preview_questionnaire_block_patch");
    const properties = tool?.inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
    const operations = properties?.operations;
    expect(operations?.maxItems).toBe(LIMITS.maxQuestions);
    expect(validateToolArgs(operations!, Array.from({ length: 51 }, () => ({ op: "delete", questionId: "old" })))).toBeNull();
    expect(validateToolArgs(operations!, Array.from({ length: LIMITS.maxQuestions + 1 }, () => ({ op: "delete", questionId: "old" }))))
      .toMatch(/at most 500 items/);
  });
});
