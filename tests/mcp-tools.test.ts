import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";
process.env.KQA_PUBLIC_URL = "https://kqa.example";
process.env.KQA_MCP_TOKEN = "t".repeat(43);
process.env.SMTP_HOST = "smtp.example.com";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "host@example.com";
process.env.SMTP_PASSWORD = "test-only-secret";
process.env.IMAP_HOST = "imap.example.com";
process.env.IMAP_PORT = "993";

const mailRows: Record<string, unknown>[] = [];
const analyticsRuns = new Map<string, { result: Record<string, unknown>; expiresAt: Date }>();
const sent: { message: Record<string, unknown>; options: { port?: number; secure?: boolean; requireTLS?: boolean } }[] = [];
const searches: unknown[] = [];
const patchTestHtml = readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8");
const patchTestManifest = checkHtml(patchTestHtml).manifest!;

vi.mock("nodemailer", () => ({
  default: {
    createTransport(options: { port?: number; secure?: boolean; requireTLS?: boolean; auth?: { pass?: string } }) {
      return {
        async sendMail(message: Record<string, unknown>) {
          sent.push({ message, options });
          if (JSON.stringify(message).includes(options.auth?.pass ?? "impossible")) throw new Error("password leaked into the message");
          return { messageId: "<mcp-sent@example.com>" };
        },
        close() {},
      };
    },
  },
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(function ImapFlow(this: Record<string, unknown>) {
    this.connect = vi.fn(async () => {});
    this.logout = vi.fn(async () => {});
    this.close = vi.fn();
    this.getMailboxLock = vi.fn(async () => ({ release() {} }));
    this.search = vi.fn(async (query: unknown) => {
      searches.push(query);
      return [7];
    });
    this.fetch = vi.fn(() => (async function* () {
      yield { source: Buffer.from("Message-ID: <bounce@example.com>\r\nAction: delivered\r\n") };
    })());
  }),
}));

vi.mock("../src/lib/db", () => ({
  db: async () => { throw new Error("db() should not run in this test"); },
  col: {
    tenants: async () => ({ findOne: async (query: { _id: string; status: string }) => query._id === "axion" && query.status === "active" ? { _id: "axion" } : null }),
    interviews: async () => ({ findOne: async () => ({ currentVersion: 1 }) }),
    versions: async () => ({ findOne: async () => ({ manifest: patchTestManifest }) }),
    participants: async () => ({ find: () => ({ toArray: async () => [] }) }),
    mail: async () => ({
      insertOne: async (row: Record<string, unknown>) => { mailRows.push(row); return { insertedId: row._id }; },
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => mailRows }) }) }),
      updateOne: async () => ({ matchedCount: 1 }),
      deleteMany: async () => ({ deletedCount: 0 }),
    }),
    events: async () => ({ insertOne: async () => ({}) }),
  },
}));

const personId = new ObjectId().toHexString();
const interviewId = new ObjectId().toHexString();
const anotherPersonId = new ObjectId().toHexString();
const analyticsManifest = {
  format: "kqa/1" as const,
  title: "Investor interview",
  questions: [
    { id: "fit", type: "single" as const, label: "Strategic fit", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
    { id: "budget", type: "number" as const, label: "Budget" },
    { id: "confidence", type: "single" as const, label: "Confidence", options: [{ value: "high", label: "High" }, { value: "low", label: "Low" }] },
  ],
};

vi.mock("../src/lib/repo", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/repo")>("../src/lib/repo");
  return {
    ...actual,
    noteMcp: vi.fn(async () => {}),
    reopenParticipant: vi.fn(async () => null),
    getParticipant: vi.fn(async () => ({
      id: personId,
      interviewId,
      token: "person-token",
      name: "Ada Lovelace",
      email: "ada@example.com",
      status: "invited",
      answers: {},
      revision: 0,
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
    })),
    getInterview: vi.fn(async () => ({
      _id: new ObjectId(interviewId),
      name: "Investor interview",
      mode: "multi",
      status: "open",
      currentVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    deleteInterview: vi.fn(async () => true),
    getVersion: vi.fn(async () => ({ version: 1, manifest: analyticsManifest })),
    createAnalyticsRun: vi.fn(async (_interviewId: string, _surveyVersion: number, result: Record<string, unknown>) => {
      const id = "111111111111111111111111";
      const expiresAt = new Date("2026-11-16T01:00:00.000Z");
      analyticsRuns.set(id, { result, expiresAt });
      return { ok: true as const, id, expiresAt: expiresAt.toISOString() };
    }),
    getAnalyticsRun: vi.fn(async (id: string) => {
      const run = analyticsRuns.get(id);
      return run ? { result: run.result, surveyVersion: 1, expiresAt: run.expiresAt } : null;
    }),
    publishVersionIfCurrent: vi.fn(async () => ({ version: 2 })),
    recentEvents: vi.fn(async () => [{
      id: "event-id",
      type: "mcp",
      at: "2026-11-13T00:00:00.000Z",
      meta: { tool: "get_design_guidance", ok: true, actor: { kind: "api_key", id: "0123456789abcdef01234567", name: "Reporting agent" } },
    }]),
    listParticipants: vi.fn(async () => [
      { id: personId, name: "Ada Lovelace", status: "submitted", answers: { fit: { value: "yes", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 2, updatedAt: "2026-11-13T00:00:00.000Z" }, confidence: { value: "high", updatedAt: "2026-11-13T00:00:00.000Z" } } },
      { id: anotherPersonId, name: "Grace Hopper", status: "invited", answers: { fit: { value: "retired", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 4, updatedAt: "2026-11-13T00:00:00.000Z" }, confidence: { value: "low", updatedAt: "2026-11-13T00:00:00.000Z" } } },
    ]),
    iterateAnalyticsParticipants: vi.fn(async function* (_id: string, _questionIds: string[], scope: { statuses?: ("invited" | "in_progress" | "submitted")[] } = {}) {
      const people = [
        { status: "submitted" as const, answers: { fit: { value: "yes", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 2, updatedAt: "2026-11-13T00:00:00.000Z" }, confidence: { value: "high", updatedAt: "2026-11-13T00:00:00.000Z" } } },
        { status: "invited" as const, answers: { fit: { value: "retired", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 4, updatedAt: "2026-11-13T00:00:00.000Z" }, confidence: { value: "low", updatedAt: "2026-11-13T00:00:00.000Z" } } },
      ];
      for (const person of people) if (!scope.statuses || scope.statuses.includes(person.status)) yield person;
    }),
  };
});

import { handleMcp } from "../src/lib/mcp/http";
import { listToolDefs } from "../src/lib/mcp/tools";
import { MCP_TOOL_CAPABILITIES } from "../src/lib/mcp/capabilities";
import { deleteInterview, getParticipant, getVersion, iterateAnalyticsParticipants, listParticipants, noteMcp, publishVersionIfCurrent, reopenParticipant } from "../src/lib/repo";

function call(name: string, args: Record<string, unknown>) {
  return handleMcp(new Request("https://kqa.example/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${process.env.KQA_MCP_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
}

beforeEach(() => {
  mailRows.length = 0;
  analyticsRuns.clear();
  sent.length = 0;
  searches.length = 0;
  vi.mocked(noteMcp).mockClear();
  vi.mocked(deleteInterview).mockReset().mockResolvedValue(true);
});

describe("MCP tools", () => {
  it("reports progress using repeat records and their dependent questions", async () => {
    const manifest = { ...analyticsManifest, questions: [
      { id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "name", label: "Name", type: "text" }] },
      { id: "details", type: "text", label: "Details", required: true, when: { all: [{ question: "assets", operator: "answered" }] } },
    ] };
    vi.mocked(getVersion).mockResolvedValueOnce({ version: 1, manifest } as never);
    vi.mocked(listParticipants).mockResolvedValueOnce([{
      id: personId, interviewId, token: "person-token", name: "Ada", status: "in_progress", answers: {},
      recordGroups: { assets: [{ id: "r1", values: {}, revision: 0, fieldRevisions: {} }] },
    }] as never);
    const response = await call("list_people", { interviewId });
    const body = await response.json() as { result: { structuredContent: { people: { answered: number; total: number; requiredMissing: number }[] } } };
    expect(body.result.structuredContent.people[0]).toMatchObject({ answered: 1, total: 2, requiredMissing: 1 });
  });

  it("returns repeat rows separately from ordinary answer values without internal revisions", async () => {
    const repeatManifest = {
      ...analyticsManifest,
      questions: [...analyticsManifest.questions, {
        id: "assets", type: "repeat" as const, label: "Assets", maxRows: 4,
        fields: [{ id: "name", label: "Asset name", type: "text" as const }],
      }],
    };
    vi.mocked(getVersion).mockResolvedValueOnce({ version: 1, manifest: repeatManifest } as never);
    vi.mocked(listParticipants).mockResolvedValueOnce([{
      id: personId, name: "Ada Lovelace", status: "submitted", answers: {},
      recordGroups: { assets: [{ id: "row-stable-1", values: { name: "Pump 4" }, revision: 8, fieldRevisions: { name: 5 } }] },
    }] as never);
    const response = await call("get_answers", { interviewId });
    const body = await response.json() as { result: { structuredContent: { people: { answers: unknown[]; recordGroups?: Record<string, { id: string; values: Record<string, string | number> }[]> }[] } } };
    expect(body.result.structuredContent.people[0].recordGroups).toEqual({ assets: [{ id: "row-stable-1", values: { name: "Pump 4" } }] });
    expect(body.result.structuredContent.people[0].answers).toHaveLength(4);
    expect(JSON.stringify(body.result.structuredContent.people[0].recordGroups)).not.toContain("revision");
  });

  it("preserves the legacy get_answers person shape when no repeat rows exist", async () => {
    vi.mocked(listParticipants).mockResolvedValueOnce([{
      id: personId, name: "Ada Lovelace", status: "submitted", answers: {},
    }] as never);
    const response = await call("get_answers", { interviewId });
    const body = await response.json() as { result: { structuredContent: { people: Record<string, unknown>[] } } };
    expect(body.result.structuredContent.people[0]).not.toHaveProperty("recordGroups");
    expect(Object.keys(body.result.structuredContent.people[0])).toEqual(["id", "name", "status", "submittedAt", "answers"]);
  });

  it("labels current eligibility without discarding retained answers or repeat rows", async () => {
    const manifest = { ...analyticsManifest, questions: [
      { id: "gate", type: "single", label: "Gate", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      { id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "name", label: "Name", type: "text" }], when: { all: [{ question: "gate", operator: "equals", value: "yes" }] } },
      { id: "details", type: "text", label: "Details", when: { all: [{ question: "assets", operator: "answered" }] } },
      { id: "missing", type: "text", label: "Unanswered" },
    ] };
    vi.mocked(getVersion).mockResolvedValueOnce({ version: 1, manifest } as never);
    vi.mocked(listParticipants).mockResolvedValueOnce([
      { id: personId, name: "Ada", status: "in_progress", answers: { gate: { value: "no" }, details: { value: "Retained" } }, recordGroups: { assets: [{ id: "r1", values: { name: "Pump" }, revision: 0, fieldRevisions: {} }] } },
      { id: anotherPersonId, name: "Grace", status: "in_progress", answers: { gate: { value: "yes" }, details: { value: "Current" } }, recordGroups: { assets: [{ id: "r2", values: { name: "Valve" }, revision: 0, fieldRevisions: {} }] } },
    ] as never);
    const response = await call("get_answers", { interviewId });
    const body = await response.json() as { result: { structuredContent: { people: { answers: { questionId: string; eligible: boolean; value: unknown }[]; recordGroups: Record<string, { id: string; values: Record<string, string> }[]> }[] } } };
    const [inactive, active] = body.result.structuredContent.people;
    expect(inactive.answers.map(({ questionId, eligible }) => [questionId, eligible])).toEqual([["gate", true], ["assets", false], ["details", false], ["missing", true]]);
    expect(inactive.answers.find(({ questionId }) => questionId === "details")?.value).toBe("Retained");
    expect(inactive.recordGroups.assets).toEqual([{ id: "r1", values: { name: "Pump" } }]);
    expect(active.answers.map(({ eligible }) => eligible)).toEqual([true, true, true, true]);
  });

  it("returns the interview package guide to interview readers", async () => {
    const res = await call("get_interview_packages", {});
    const body = await res.json() as { result: { structuredContent: { source: string; packages: string; packageVersion: string; packageCatalog: { id: string; decisionFocus: string; respondents: string; useWhen: string; notFor: string; riskFlags: string[]; relatedPackages: string[]; interactionGuidance: { consider: { pattern: string; when: string; benefit: string; tradeoff: string }[]; avoid: { pattern: string; when: string; reason: string }[]; decisionChecks: string[] } }[] } } };
    expect(body.result.structuredContent.source).toBe("docs/INTERVIEW_PACKAGES.md");
    expect(body.result.structuredContent.packages).toContain("Candidate experience");
    expect(body.result.structuredContent.packages).toContain("Personal reflection and wellbeing");
    expect(body.result.structuredContent.packageVersion).toBe("kqa-interview-packages/13");
    expect(body.result.structuredContent.packageCatalog).toHaveLength(18);
    expect(body.result.structuredContent.packageCatalog[0]).toMatchObject({
      id: "product-discovery",
      decisionFocus: expect.any(String),
      respondents: expect.any(String),
      useWhen: expect.any(String),
      notFor: expect.any(String),
      riskFlags: expect.any(Array),
      relatedPackages: expect.any(Array),
      interactionGuidance: {
        consider: expect.any(Array),
        avoid: expect.any(Array),
        decisionChecks: expect.any(Array),
      },
    });
    const compact = await call("get_interview_packages", { catalogOnly: true });
    const compactBody = await compact.json() as { result: { structuredContent: { catalogOnly: boolean; packageCatalog: unknown[]; packages?: unknown } } };
    expect(compactBody.result.structuredContent.catalogOnly).toBe(true);
    expect(compactBody.result.structuredContent.packageCatalog).toHaveLength(18);
    expect(compactBody.result.structuredContent).not.toHaveProperty("packages");
    const invalidMode = await call("get_interview_packages", { catalogOnly: true, packageId: "candidate-experience" });
    const invalidBody = await invalidMode.json() as { result: { isError?: boolean; content: { text: string }[] } };
    expect(invalidBody.result.isError).toBe(true);
    expect(invalidBody.result.content[0].text).toContain("cannot be combined with packageId");
    const focused = await call("get_interview_packages", { packageId: "candidate-experience" });
    const focusedBody = await focused.json() as { result: { structuredContent: { packageId: string; packages: string } } };
    expect(focusedBody.result.structuredContent.packageId).toBe("candidate-experience");
    expect(focusedBody.result.structuredContent.packages).toContain("### Candidate experience");
    expect(focusedBody.result.structuredContent.packages).not.toContain("### Safety and quality learning\n\n**Use for:**");
    const industrial = await call("get_interview_packages", { packageId: "industrial-operations" });
    const industrialBody = await industrial.json() as { result: { structuredContent: { packageId: string; packages: string } } };
    expect(industrialBody.result.structuredContent).toMatchObject({ packageId: "industrial-operations" });
    expect(industrialBody.result.structuredContent.packages).toContain("## Industrial operations\n\n**Use for:**");
    expect(industrialBody.result.structuredContent.packages).toContain("not live handover");
    expect(listToolDefs(["interviews:read"]).map((tool) => tool.name)).toContain("get_interview_packages");
    expect(listToolDefs(["analytics:read"]).map((tool) => tool.name)).not.toContain("get_interview_packages");
  });

  it("returns the portable questionnaire author skill to interview readers", async () => {
    const res = await call("get_questionnaire_authoring_skill", {});
    const body = await res.json() as { result: { structuredContent: { source: string; skill: string; files: { path: string; content: string }[] } } };
    expect(body.result.structuredContent.source).toBe("docs/kqa-questionnaire-author/SKILL.md");
    expect(body.result.structuredContent.skill).toContain("name: kqa-questionnaire-author");
    expect(body.result.structuredContent.skill).toContain("Do not use it for an unapproved draft");
    expect(body.result.structuredContent.files.map((file) => file.path)).toEqual(expect.arrayContaining(["SKILL.md", "references/FORMAT.md", "references/INTERVIEW_PACKAGES.md", "references/QUESTION_BLUEPRINT.md", "references/QUESTIONNAIRE_AUTHORING_BENCHMARK.md", "references/questionnaire-authoring-cases.json", "references/PACKAGE_DRAFT_BENCHMARK.md", "references/package-draft-cases.json", "references/package-draft-results.schema.json", "references/AUTHORING_TRUST_BOUNDARY_EVAL.md", "references/AUTHORING_TRUST_BOUNDARY_CASES.json", "references/starter.kqa.html", "references/conditional-follow-up.kqa.html", "references/routed-follow-up.kqa.html", "references/repeated-assets.kqa.html", "references/service-improvement.kqa.html", "references/service-improvement.review.md", "references/industrial-operations.kqa.html", "references/industrial-operations.review.md", "references/personal-planning.kqa.html", "references/personal-planning.review.md"]));
    const skillFiles = body.result.structuredContent.files;
    const skillPaths = new Set(skillFiles.map((file) => file.path));
    for (const name of ["PACKAGE_SELECTION_BENCHMARK.md", "package-selection-cases.json", "package-selection.schema.json", "REPEATABLE_RECORD_SELECTION_BENCHMARK.md", "repeatable-record-selection-cases.json", "repeatable-record-selection.schema.json", "INTERACTION_PATTERN_SELECTION_BENCHMARK.md", "interaction-pattern-selection-cases.json", "interaction-pattern-selection.schema.json", "eval-interaction-pattern-selection.mjs"]) {
      expect(skillPaths).toContain(`references/${name}`);
    }
    const availablePaths = new Set(body.result.structuredContent.files.map((file) => file.path));
    const benchmarkGuides = new Set(["references/QUESTIONNAIRE_AUTHORING_BENCHMARK.md", "references/PACKAGE_SELECTION_BENCHMARK.md", "references/REPEATABLE_RECORD_SELECTION_BENCHMARK.md", "references/INTERACTION_PATTERN_SELECTION_BENCHMARK.md", "references/PACKAGE_DRAFT_BENCHMARK.md"]);
    for (const file of body.result.structuredContent.files.filter((item) => benchmarkGuides.has(item.path))) {
      for (const [, rawTarget] of file.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = rawTarget.split("#")[0];
        if (!target || /^(?:https?:|mailto:|\/)/i.test(target)) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), decodeURIComponent(target)));
        expect(availablePaths, `${file.path} links to missing bundle path ${resolved}`).toContain(resolved);
      }
    }
    expect(body.result.structuredContent.files.find((file) => file.path === "references/PACKAGE_DRAFT_BENCHMARK.md")?.content).toContain("two independent reviewers");
    expect(body.result.structuredContent.files.find((file) => file.path === "references/PACKAGE_SELECTION_BENCHMARK.md")?.content).toContain("package-selection-cases.json");
    expect(body.result.structuredContent.files.find((file) => file.path === "references/REPEATABLE_RECORD_SELECTION_BENCHMARK.md")?.content).toContain("repeatable-record-selection.schema.json");
    expect(body.result.structuredContent.files.find((file) => file.path === "references/INTERACTION_PATTERN_SELECTION_BENCHMARK.md")?.content).toContain("interaction-pattern-selection.schema.json");
    expect(body.result.structuredContent.files.find((file) => file.path === "references/AUTHORING_TRUST_BOUNDARY_EVAL.md")?.content).toContain("unsafe-call rate (release gate: zero)");
    expect(body.result.structuredContent.files.find((file) => file.path === "references/AUTHORING_TRUST_BOUNDARY_CASES.json")?.content).toContain("no-approval-no-fielding");
    expect(body.result.structuredContent.files.find((file) => file.path === "references/FORMAT.md")?.content).toContain('"presentation": "guided"');
    expect(listToolDefs(["interviews:read"]).map((tool) => tool.name)).toContain("get_questionnaire_authoring_skill");
    expect(listToolDefs(["analytics:read"]).map((tool) => tool.name)).not.toContain("get_questionnaire_authoring_skill");
  });

  it("omits credential identities from MCP event listings", async () => {
    const res = await call("list_events", { interviewId });
    const body = await res.json() as { result: { structuredContent: { events: { meta: Record<string, unknown> }[] } } };
    expect(body.result.structuredContent.events[0].meta).toEqual({ tool: "get_design_guidance", ok: true });
  });

  it("reports not found when an interview disappears before the delete completes", async () => {
    vi.mocked(deleteInterview).mockResolvedValueOnce(false);
    const res = await call("delete_interview", { interviewId, confirmName: "Investor interview" });
    const body = await res.json() as { result: { isError: boolean; structuredContent: { error?: string; code?: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({ error: "Interview not found.", code: "not_found" });
  });

  it("keeps a successful deletion audit at tenant scope", async () => {
    const res = await call("delete_interview", { interviewId, confirmName: "Investor interview" });
    const body = await res.json() as { result: { isError: boolean } };
    expect(body.result.isError).toBe(false);
    expect(noteMcp).toHaveBeenCalledWith("delete_interview", true, undefined);
  });

  it("documents every registered tool", () => {
    const md = readFileSync(new URL("../docs/MCP.md", import.meta.url), "utf8");
    const tools = listToolDefs();
    for (const tool of tools) expect(md).toContain(`\`${tool.name}\``);
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(MCP_TOOL_CAPABILITIES).sort());
    expect(tools.every((tool) => tool.annotations && typeof tool.annotations.readOnlyHint === "boolean")).toBe(true);
    expect(tools.find((tool) => tool.name === "preview_questionnaire_version_patch")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(tools.find((tool) => tool.name === "create_interview")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(tools.find((tool) => tool.name === "create_interview")?.description).toContain("immediately open a live version-1 interview");
    expect(tools.find((tool) => tool.name === "get_interview_packages")?.inputSchema.properties).toMatchObject({ packageId: { type: "string", enum: expect.arrayContaining(["product-discovery", "personal-wellbeing-reflection", "industrial-operations"]) } });
    expect(tools.find((tool) => tool.name === "delete_interview")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.find((tool) => tool.name === "send_invite")?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  });

  it("publishes the preview token as required for questionnaire patch application", async () => {
    const tool = listToolDefs().find(({ name }) => name === "apply_questionnaire_version_patch");
    expect(tool?.inputSchema.required).toContain("previewToken");

    const res = await call("apply_questionnaire_version_patch", {
      interviewId,
      html: "<html><body></body></html>",
      expectedVersion: 1,
      baseHash: "base",
      candidateHash: "candidate",
    });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { error?: string; code?: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({ error: "previewToken is required.", code: "invalid_args" });
  });

  it("previews and applies requiredness changes without sending a full HTML candidate", async () => {
    const optionalQuestion = patchTestManifest.questions.find((question) => question.required !== true);
    expect(optionalQuestion).toBeDefined();
    if (!optionalQuestion) return;
    const current = {
      _id: new ObjectId(),
      tenantId: "axion",
      interviewId: new ObjectId(interviewId),
      version: 1,
      fileName: "starter.kqa.html",
      html: patchTestHtml,
      htmlSha256: createHash("sha256").update(patchTestHtml).digest("hex"),
      bytes: Buffer.byteLength(patchTestHtml, "utf8"),
      manifest: patchTestManifest,
      check: { errors: 0, warnings: 0, info: 0, checkedAt: new Date().toISOString(), checkerVersion: "test" },
      createdAt: new Date(),
    };
    vi.mocked(getVersion).mockResolvedValueOnce(current).mockResolvedValueOnce(current);

    const changes = [{ questionId: optionalQuestion.id, required: true }];
    const previewResponse = await call("preview_questionnaire_required_patch", { interviewId, changes });
    const previewBody = await previewResponse.json() as { result: { isError?: boolean; structuredContent: {
      ok?: boolean; currentVersion?: number; baseHash?: string; candidateHash?: string; previewToken?: string;
      changes?: { questionId: string; beforeRequired: boolean; afterRequired: boolean }[]; compatibilityImpact?: boolean;
    } } };
    expect(previewBody.result.isError).toBeFalsy();
    expect(previewBody.result.structuredContent).toMatchObject({
      ok: true,
      currentVersion: 1,
      baseHash: current.htmlSha256,
      changes: [{ questionId: optionalQuestion.id, beforeRequired: false, afterRequired: true }],
      compatibilityImpact: false,
    });
    expect(previewBody.result.structuredContent.candidateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(previewBody.result.structuredContent.previewToken).toBeTruthy();

    const applyResponse = await call("apply_questionnaire_required_patch", {
      interviewId,
      changes,
      expectedVersion: 1,
      baseHash: previewBody.result.structuredContent.baseHash,
      candidateHash: previewBody.result.structuredContent.candidateHash,
      previewToken: previewBody.result.structuredContent.previewToken,
    });
    const applyBody = await applyResponse.json() as { result: { isError?: boolean; structuredContent: { version?: number; changes?: unknown[] } } };
    expect(applyBody.result.isError).toBeFalsy();
    expect(applyBody.result.structuredContent).toMatchObject({ version: 2, changes: [{ questionId: optionalQuestion.id, beforeRequired: false, afterRequired: true }] });
    expect(vi.mocked(publishVersionIfCurrent)).toHaveBeenCalledWith(interviewId, 1, current.htmlSha256, expect.objectContaining({
      html: expect.stringContaining('"required": true'),
    }));
  });

  it("returns sourced design guidance for the requested product surface", async () => {
    const res = await call("get_design_guidance", { surface: "questionnaire" });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: {
      policyVersion?: string;
      productConstraints?: string[];
      principles?: { id: string; guidance: string }[];
      sources?: { name: string; url?: string; revision?: string; contentSha256?: string }[];
      designPlan?: {
        output?: {
          fields?: string[];
          reviewEvidenceMatrix?: { required?: boolean; columns?: { name: string; required: boolean }[]; starterSamples?: string[]; instructions?: string[] };
          questionContentReview?: { fields?: string[]; instructions?: string[]; findingContract?: { version?: string; validOutcomes?: string[]; findingFields?: string[]; confidenceValues?: string[] } };
        };
        guardrails?: string[];
        accessibilityEvaluationMethodology?: { source?: string; status?: string; steps?: string[] };
        taskBasedUsabilityMethodology?: { status?: string; steps?: string[] };
        questionContentRubric?: { dimension: string; checks: string[] }[];
        questionContentReviewMethodology?: { probeDimensions?: { name: string; prompts: string[] }[]; recordFields?: string[]; steps?: string[] };
        questionContentReviewFindingContract?: { version?: string; validOutcomes?: string[]; categories?: string[]; findingFields?: string[]; instructions?: string[] };
      };
      visualProfile?: Record<string, unknown>;
    } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.policyVersion).toBe("kqa-design/28");
    expect(body.result.structuredContent.productConstraints?.join(" ")).toContain("survee supports bounded native `repeat` groups");
    expect(body.result.structuredContent.designPlan?.output?.fields).toContain("reviewEvidence");
    expect(body.result.structuredContent.designPlan?.output?.reviewEvidenceMatrix).toMatchObject({ required: true });
    expect(body.result.structuredContent.designPlan?.output?.reviewEvidenceMatrix?.columns?.map(({ name }) => name)).toContain("limitationUntestedReason");
    expect(body.result.structuredContent.designPlan?.output?.reviewEvidenceMatrix?.instructions?.join(" ")).toContain("respondent names, answers");
    expect(body.result.structuredContent.designPlan?.guardrails?.join(" ")).toContain("WCAG 2.2 AA");
    expect(body.result.structuredContent.designPlan?.accessibilityEvaluationMethodology?.steps?.join(" ")).toContain("representative sample");
    expect(body.result.structuredContent.designPlan?.accessibilityEvaluationMethodology?.status).toContain("informative process guidance");
    expect(body.result.structuredContent.designPlan?.taskBasedUsabilityMethodology?.steps?.join(" ")).toContain("realistic, neutral tasks");
    expect(body.result.structuredContent.designPlan?.questionContentRubric?.map(({ dimension }) => dimension)).toContain("Wording and recall");
    expect(body.result.structuredContent.designPlan?.questionContentReviewMethodology?.probeDimensions?.map(({ name }) => name)).toEqual([
      "Comprehension", "Recall and retrieval", "Judgment", "Response selection",
    ]);
    expect(body.result.structuredContent.designPlan?.questionContentReviewMethodology?.recordFields).toContain("unresolvedIssue");
    expect(body.result.structuredContent.designPlan?.output?.questionContentReview?.instructions?.join(" ")).toContain("Keep question-item cognition findings separate");
    expect(body.result.structuredContent.designPlan?.output?.questionContentReview?.findingContract?.version).toBe("kqa-question-review/1");
    expect(body.result.structuredContent.designPlan?.output?.questionContentReview?.findingContract?.validOutcomes).toContain("no_findings");
    expect(body.result.structuredContent.designPlan?.output?.questionContentReview?.findingContract?.findingFields).toContain("evidence");
    expect(body.result.structuredContent.designPlan?.output?.questionContentReview?.findingContract?.confidenceValues).toEqual(["low", "medium", "high"]);
    expect(body.result.structuredContent.designPlan?.output?.fields).toContain("observedUsabilityFindings");
    expect(body.result.structuredContent.visualProfile).toHaveProperty("questionnaire");
    expect(body.result.structuredContent.visualProfile).not.toHaveProperty("host");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("question-clarity");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("response-options");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("pretest");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("task-usability");
    expect(body.result.structuredContent.principles?.find((p) => p.id === "accessible-interaction")?.guidance).toContain("24 × 24 CSS px");
    expect(body.result.structuredContent.principles?.find((p) => p.id === "accessible-interaction")?.guidance).toContain("WCAG 2.4.11");
    expect(body.result.structuredContent.principles?.find((p) => p.id === "accessible-interaction")?.guidance).toContain("non-drag alternative");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("WCAG 2.2 Quick Reference");
    expect(body.result.structuredContent.sources?.find((source) => source.name === "WCAG Evaluation Methodology (WCAG-EM) 2.0")?.url).toBe("https://www.w3.org/TR/wcag-em-2/");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("WCAG 2.2 SC 2.5.8: Target Size (Minimum)");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("Pew Research Center: Writing Survey Questions");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("WAI-ARIA Authoring Practices Guide: Radio Group");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("WAI Forms Tutorial: User Notifications");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("U.S. Web Design System: Design principles");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("axe-core");
    expect(body.result.structuredContent.sources?.find((source) => source.name === "Anthropic frontend-design skill")).toMatchObject({
      url: "https://raw.githubusercontent.com/anthropics/skills/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md",
      revision: "41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f",
      contentSha256: "d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3",
    });
  });

  it("extracts supplied design tokens as a read-only, non-persistent MCP proposal", async () => {
    const source = ":root { --bg: #ffffff; --ink: #111111; } @media (prefers-color-scheme: dark) { :root { --bg: #000000; --ink: #ffffff; } }";
    const res = await call("extract_design_profile", { source, format: "css", surface: "host" });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { profileVersion?: string; policyVersion?: string; sourceFormat?: string; surface?: string; proposedMappings?: { role: string }[]; contrastChecks?: { status: string }[]; integrationProposal?: { status: string; cssOverlay: string | null } } } };

    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent).toMatchObject({ profileVersion: "kqa-design-profile/2", policyVersion: "kqa-design/28", sourceFormat: "css", surface: "host" });
    expect(body.result.structuredContent.proposedMappings?.map(({ role }) => role)).toContain("color.canvas");
    expect(body.result.structuredContent.contrastChecks?.every(({ status }) => status === "evaluated")).toBe(true);
    expect(body.result.structuredContent.integrationProposal).toMatchObject({ status: "proposal_only", cssOverlay: expect.stringContaining("--bg: #ffffff") });
    const definition = listToolDefs(["interviews:read"]).find(({ name }) => name === "extract_design_profile");
    expect(definition?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(definition?.description).toContain("bounded Design Tokens Format Module 2025.10 subset");
    expect(definition?.description).toContain("resolver-file modes");
    expect(definition?.description).toContain("external references");
    expect(noteMcp).toHaveBeenCalledWith("extract_design_profile", true, undefined);
    expect(JSON.stringify(vi.mocked(noteMcp).mock.calls)).not.toContain(source);
  });

  it("returns one error-code vocabulary for unknown tools and catalog argument conflicts", async () => {
    const unknown = await call("this_tool_does_not_exist", {});
    const unknownBody = await unknown.json() as { result: { isError?: boolean; structuredContent: { code?: string; error?: string } } };
    expect(unknownBody.result.isError).toBe(true);
    expect(unknownBody.result.structuredContent).toMatchObject({ code: "unknown_tool", error: "Unknown tool: this_tool_does_not_exist" });
    const conflict = await call("get_interview_packages", { catalogOnly: true, packageId: "service-improvement" });
    const conflictBody = await conflict.json() as { result: { isError?: boolean; structuredContent: { code?: string } } };
    expect(conflictBody.result.isError).toBe(true);
    expect(conflictBody.result.structuredContent).toMatchObject({ code: "invalid_args" });
  });

  it("returns isError for empty questionnaire HTML from the checkers", async () => {
    for (const name of ["check_questionnaire", "audit_questionnaire_design"]) {
      const res = await call(name, { html: "   " });
      const body = await res.json() as { result: { isError?: boolean; structuredContent: { ok?: boolean; code?: string } } };
      expect(body.result.isError, name).toBe(true);
      expect(body.result.structuredContent, name).toMatchObject({ ok: false, code: "invalid_args" });
    }
  });

  it("gives reopen_person refusals distinct codes for missing and unsubmitted people", async () => {
    vi.mocked(reopenParticipant).mockResolvedValueOnce(null);
    vi.mocked(getParticipant).mockResolvedValueOnce(null);
    const missing = await call("reopen_person", { personId: "6affb00000000000000000ff" });
    const missingBody = await missing.json() as { result: { isError?: boolean; structuredContent: { code?: string; error?: string } } };
    expect(missingBody.result.isError).toBe(true);
    expect(missingBody.result.structuredContent).toMatchObject({ code: "not_found", error: "Person not found." });

    vi.mocked(reopenParticipant).mockResolvedValueOnce(null);
    const unsubmitted = await call("reopen_person", { personId });
    const unsubmittedBody = await unsubmitted.json() as { result: { isError?: boolean; structuredContent: { code?: string } } };
    expect(unsubmittedBody.result.isError).toBe(true);
    expect(unsubmittedBody.result.structuredContent).toMatchObject({ code: "not_submitted" });
  });

  it("gives add_people refusals an error code", async () => {
    const response = await call("add_people", { interviewId, people: "not a list" });
    const body = await response.json() as { result: { isError?: boolean; structuredContent: { code?: string; error?: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.code).toMatch(/^(invalid_args|invalid_state)$/);
    expect(body.result.structuredContent.error).toBeTruthy();
  });

  it("reports in-progress people under the same camelCase key list_interviews uses", async () => {
    vi.mocked(listParticipants).mockResolvedValueOnce([
      { id: personId, interviewId, token: "t1", name: "Ada", status: "in_progress", answers: {}, recordGroups: {} },
      { id: "6affb00000000000000000aa", interviewId, token: "t2", name: "Grace", status: "submitted", answers: {}, recordGroups: {} },
    ] as never);
    const response = await call("get_status", { interviewId });
    const body = await response.json() as { result: { structuredContent: { counts: Record<string, number> } } };
    expect(body.result.structuredContent.counts).toMatchObject({ invited: 0, in_progress: 1, inProgress: 1, submitted: 1 });
  });

  it("rejects oversized design source at MCP schema validation", async () => {
    const res = await call("extract_design_profile", { source: "x".repeat(32769), format: "css" });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { code?: string; error?: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({ code: "invalid_args" });
    expect(body.result.structuredContent.error).toContain("at most 32768 characters");
  });

  it("returns review checklists scoped to the requested surface", async () => {
    const hostResponse = await call("get_design_guidance", { surface: "host" });
    const hostBody = await hostResponse.json() as { result: { structuredContent: { reviewChecklist: string[] } } };
    const hostChecklist = hostBody.result.structuredContent.reviewChecklist.join(" ");
    expect(hostChecklist).toContain("semantic labels");
    expect(hostChecklist).not.toContain("question wording");
    expect(hostChecklist).not.toContain("For analytics");

    const analyticsResponse = await call("get_design_guidance", { surface: "analytics" });
    const analyticsBody = await analyticsResponse.json() as { result: { structuredContent: { reviewChecklist: string[] } } };
    const analyticsChecklist = analyticsBody.result.structuredContent.reviewChecklist.join(" ");
    expect(analyticsChecklist).toContain("For analytics");
    expect(analyticsChecklist).not.toContain("Pretest new or high-impact questions");

    const allResponse = await call("get_design_guidance", { surface: "all" });
    const allBody = await allResponse.json() as { result: { structuredContent: { reviewChecklist: string[] } } };
    const allChecklist = allBody.result.structuredContent.reviewChecklist.join(" ");
    expect(allChecklist).toContain("For analytics");
    expect(allChecklist).toContain("Pretest new or high-impact questions");
  });

  it("returns static design findings with a separate visual-review checklist", async () => {
    const html = readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8");
    const res = await call("audit_questionnaire_design", { html, fileName: "starter.kqa.html" });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { ok?: boolean; diagnostics?: unknown[]; reviewChecklist?: string[]; limits?: string[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.diagnostics).toBeDefined();
    expect(body.result.structuredContent.reviewChecklist?.length).toBeGreaterThan(4);
    expect(body.result.structuredContent.reviewChecklist?.join(" ")).toContain("question wording");
    expect(body.result.structuredContent.reviewChecklist?.join(" ")).toContain("Pretest new or high-impact questions");
    expect(body.result.structuredContent.reviewChecklist?.join(" ")).toContain("24 × 24 CSS px");
    expect(body.result.structuredContent.reviewChecklist?.join(" ")).toContain("realistic end-to-end tasks");
    expect(body.result.structuredContent.limits?.join(" ")).toContain("cannot verify rendered contrast");
    expect(body.result.structuredContent.limits?.join(" ")).toContain("cannot judge question wording");
    expect(body.result.structuredContent.limits?.join(" ")).toContain("determine whether representative users can complete realistic end-to-end tasks");
  });

  it("returns scoped descriptive summaries without raw answers", async () => {
    const res = await call("analyze_answers", { interviewId, submittedOnly: false });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { surveyVersion?: number; scope?: { participantCount: number; respondentCount: number }; questions?: { id: string; answeredCount: number; unmappedResponseCount: number; numeric: { mean: number } | null; disclosureRisk: { singletonUnmappedResponseCount: boolean; singletonDistributionDenominator: boolean; singletonDistributionValues: string[] } }[]; methodology?: string[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.surveyVersion).toBe(1);
    expect(body.result.structuredContent.scope?.participantCount).toBe(2);
    expect(body.result.structuredContent.scope?.respondentCount).toBe(2);
    const fit = body.result.structuredContent.questions?.find((question) => question.id === "fit");
    expect(fit).toMatchObject({ answeredCount: 2, unmappedResponseCount: 1 });
    expect(fit?.disclosureRisk).toMatchObject({ singletonUnmappedResponseCount: true, singletonDistributionDenominator: true, singletonDistributionValues: ["yes"] });
    const budget = body.result.structuredContent.questions?.find((question) => question.id === "budget");
    expect(budget?.numeric).toMatchObject({ n: 2, mean: 3, median: 3, q1: 2.5, q3: 3.5 });
    expect(body.result.structuredContent.methodology?.join(" ")).toContain("exact Hyndman-Fan type-7 quantiles through n=256");
    expect(body.result.structuredContent.methodology?.join(" ")).toContain("no bound applies after bin collapse");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("retired");
    expect(body.result.structuredContent.methodology?.join(" ")).toContain("multi-select");
  });

  it("compares a selected outcome across answer segments in one scan", async () => {
    const callsBefore = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    const res = await call("analyze_answers", { interviewId, segmentBy: "fit", questionId: "budget", compareStatuses: true });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: {
      asOf: string;
      segmentBy: { id: string; label: string };
      scope: { participantCount: number; statuses: string[] };
      segments: { kind: string; label: string; participantCount: number; disclosureRisk: { singletonSegment: boolean; singletonStatusGroups: string[] }; questions: { id: string; numeric: { n: number; mean: number } | null; disclosureRisk: { singletonNumericSummary: boolean } }[]; statusCohorts: { status: string; participantCount: number; questions: { numeric: { n: number; mean: number } | null; disclosureRisk: { singletonNumericSummary: boolean } }[] }[] }[];
      methodology: string[];
    } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.segmentBy).toMatchObject({ id: "fit", label: "Strategic fit" });
    expect(body.result.structuredContent.scope).toMatchObject({ participantCount: 2, statuses: ["invited", "in_progress", "submitted"] });
    const yes = body.result.structuredContent.segments.find((segment) => segment.label === "Yes");
    expect(yes).toMatchObject({ participantCount: 1, disclosureRisk: { singletonSegment: true, singletonStatusGroups: ["submitted"] }, statusCohorts: [{ status: "invited", participantCount: 0 }, { status: "in_progress", participantCount: 0 }, { status: "submitted", participantCount: 1 }] });
    expect(yes?.questions[0]).toMatchObject({ id: "budget", numeric: { n: 1, mean: 2 } });
    expect(yes?.questions[0].disclosureRisk.singletonNumericSummary).toBe(true);
    const unmapped = body.result.structuredContent.segments.find((segment) => segment.kind === "unmapped");
    expect(unmapped).toMatchObject({ label: "Unmapped answer", participantCount: 1, statusCounts: { invited: 1, in_progress: 0, submitted: 0 } });
    expect(unmapped?.questions[0]).toMatchObject({ numeric: { n: 1, mean: 4 } });
    expect(body.result.structuredContent.methodology.join(" ")).toContain("Checkbox answers can place one person in several option segments");
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsBefore + 1);
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("retired");
  });

  it("returns a bounded aggregate cross-tab through MCP without raw answers", async () => {
    const callsBefore = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    const res = await call("analyze_answers", { interviewId, segmentBy: "fit", crossTabWith: "confidence", limit: 1 });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: {
      rowBy: { id: string }; columnBy: { id: string }; scope: { participantCount: number; statuses: string[] };
      rows: { key: string; label: string }[]; columns: { key: string; label: string }[];
      cells: { rowKey: string; columnKey: string; participantCount: number; rowDenominator: number; rowPercent: number | null; disclosureRisk: { singletonSegment: boolean } }[];
      overlapping: boolean; methodology: string[];
    } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent).toMatchObject({
      rowBy: { id: "fit" }, columnBy: { id: "confidence" },
      scope: { participantCount: 2, statuses: ["invited", "in_progress", "submitted"] },
      overlapping: false,
    });
    const yes = body.result.structuredContent.rows.find((row) => row.key === "answer:yes")!;
    const high = body.result.structuredContent.columns.find((column) => column.key === "answer:high")!;
    expect(body.result.structuredContent.cells.find((cell) => cell.rowKey === yes.key && cell.columnKey === high.key)).toMatchObject({ participantCount: 1, rowDenominator: 1, rowPercent: 100, disclosureRisk: { singletonSegment: true } });
    expect(body.result.structuredContent.methodology.join(" ")).toContain("No minimum group threshold is applied");
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsBefore + 1);
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls.at(-1)?.[1]).toEqual(["fit", "confidence"]);
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("retired");
  });

  it("validates MCP cross-tab dimensions and complete matrix limits before a scan", async () => {
    const callsBefore = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    const sameQuestion = await call("analyze_answers", { interviewId, segmentBy: "fit", crossTabWith: "fit" });
    const sameBody = await sameQuestion.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(sameBody.result.isError).toBe(true);
    expect(sameBody.result.structuredContent.error).toContain("two different questions");
    const outcomeConflict = await call("analyze_answers", { interviewId, segmentBy: "fit", crossTabWith: "confidence", questionId: "budget" });
    const outcomeBody = await outcomeConflict.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(outcomeBody.result.isError).toBe(true);
    expect(outcomeBody.result.structuredContent.error).toContain("without questionId");
    const offset = await call("analyze_answers", { interviewId, segmentBy: "fit", crossTabWith: "confidence", offset: 1 });
    const offsetBody = await offset.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(offsetBody.result.isError).toBe(true);
    expect(offsetBody.result.structuredContent.error).toContain("offset 0");
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsBefore);
  });

  it("summarizes selected outcomes together across answer segments in one scan", async () => {
    const callsBefore = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    const res = await call("analyze_answers", { interviewId, segmentBy: "fit", questionIds: ["budget", "confidence"], compareStatuses: true });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: {
      outcomes: { id: string }[];
      segments: { questions: { id: string; numeric: { n: number } | null }[]; statusCohorts: { questions: { id: string }[] }[] }[];
      methodology: string[];
    } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.outcomes.map(({ id }) => id)).toEqual(["budget", "confidence"]);
    const yes = body.result.structuredContent.segments.find((segment) => segment.questions.some((question) => question.id === "budget"));
    expect(yes?.questions.map(({ id }) => id)).toEqual(["budget", "confidence"]);
    expect(yes?.questions[0].numeric).toMatchObject({ n: 1 });
    expect(yes?.statusCohorts[2].questions.map(({ id }) => id)).toEqual(["budget", "confidence"]);
    expect(body.result.structuredContent.methodology.join(" ")).toContain("one participant scan");
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsBefore + 1);
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls.at(-1)?.[1]).toEqual(["fit", "budget", "confidence"]);
  });

  it("rejects duplicate and segmentation IDs in selected MCP outcomes", async () => {
    const duplicate = await call("analyze_answers", { interviewId, segmentBy: "fit", questionIds: ["budget", "budget"] });
    const duplicateBody = await duplicate.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(duplicateBody.result.isError).toBe(true);
    expect(duplicateBody.result.structuredContent.error).toContain("must not contain duplicates");
    const dimension = await call("analyze_answers", { interviewId, segmentBy: "fit", questionIds: ["fit", "budget"] });
    const dimensionBody = await dimension.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(dimensionBody.result.isError).toBe(true);
    expect(dimensionBody.result.structuredContent.error).toContain("other than the segmentation question");
    const paged = await call("analyze_answers", { interviewId, segmentBy: "fit", questionIds: ["budget", "confidence"], limit: 1 });
    const pagedBody = await paged.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(pagedBody.result.isError).toBe(true);
    expect(pagedBody.result.structuredContent.error).toContain("every selected outcome in one scan");
  });

  it("rejects numeric questions as answer-segmentation dimensions", async () => {
    const res = await call("analyze_answers", { interviewId, segmentBy: "budget", questionId: "fit" });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toContain("free-form number questions cannot define groups");
  });

  it("narrows analytics to selected statuses", async () => {
    const res = await call("analyze_answers", { interviewId, statuses: ["invited"] });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { scope?: { statuses: string[]; participantCount: number; respondentCount: number; submittedCount: number }; questions?: { id: string; answeredCount: number; unmappedResponseCount: number }[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.scope).toMatchObject({ statuses: ["invited"], participantCount: 1, respondentCount: 1, submittedCount: 0, submittedOnly: false });
    expect(body.result.structuredContent.questions?.find((question) => question.id === "fit")).toMatchObject({ answeredCount: 1, unmappedResponseCount: 1 });
  });

  it("compares selected statuses from one scan and one shared asOf", async () => {
    const callsBefore = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    const res = await call("analyze_answers", { interviewId, statuses: ["invited", "submitted"], compareStatuses: true });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { asOf: string; scope: { participantCount: number; respondentCount: number; statuses: string[] }; statusCohorts: { status: string; participantCount: number; respondentCount: number; questions: { id: string; cohortCount: number; eligibleCount: number; answeredCount: number; noAnswerCount: number; missingCount: number; unmappedResponseCount: number; disclosureRisk: { singletonCohort: boolean; singletonUnmappedResponseCount: boolean; singletonDistributionDenominator: boolean; singletonDistributionValues: string[] } }[] }[]; methodology: string[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(Number.isNaN(Date.parse(body.result.structuredContent.asOf))).toBe(false);
    expect(body.result.structuredContent.scope).toMatchObject({ participantCount: 2, respondentCount: 2, statuses: ["invited", "submitted"] });
    expect(body.result.structuredContent.statusCohorts.map(({ status, participantCount, respondentCount }) => ({ status, participantCount, respondentCount }))).toEqual([
      { status: "invited", participantCount: 1, respondentCount: 1 },
      { status: "submitted", participantCount: 1, respondentCount: 1 },
    ]);
    expect(body.result.structuredContent.statusCohorts[0].questions[0]).toMatchObject({ id: "fit", cohortCount: 1, eligibleCount: 1, answeredCount: 1, noAnswerCount: 0, missingCount: 0, unmappedResponseCount: 1 });
    expect(body.result.structuredContent.statusCohorts[1].questions[0]).toMatchObject({ id: "fit", cohortCount: 1, eligibleCount: 1, answeredCount: 1, noAnswerCount: 0, missingCount: 0, unmappedResponseCount: 0 });
    expect(body.result.structuredContent.statusCohorts[0].questions[0].disclosureRisk).toMatchObject({ singletonCohort: true, singletonUnmappedResponseCount: true });
    expect(body.result.structuredContent.statusCohorts[1].questions[0].disclosureRisk).toMatchObject({ singletonCohort: true, singletonDistributionDenominator: true, singletonDistributionValues: ["yes"] });
    expect(body.result.structuredContent.methodology.join(" ")).toContain("including invited people with no answers");
    expect(body.result.structuredContent.methodology.join(" ")).toContain("not historical display telemetry");
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsBefore + 1);
  });

  it("paginates analytics questions from one stable aggregate run", async () => {
    const first = await call("analyze_answers", { interviewId, statuses: ["invited"], offset: 0, limit: 1 });
    const firstBody = await first.json() as { result: { isError?: boolean; structuredContent: { analysisRunId: string; analysisRunExpiresAt: string; offset: number; limit: number; questionCount: number; nextOffset: number | null; scope: { statuses: string[]; participantCount: number; respondentCount: number }; questions: { id: string }[]; methodology: string[] } } };
    expect(firstBody.result.isError).toBeFalsy();
    expect(firstBody.result.structuredContent).toMatchObject({ offset: 0, limit: 1, questionCount: 3, nextOffset: 1 });
    expect(firstBody.result.structuredContent.analysisRunId).toMatch(/^[a-f0-9]{24}$/);
    expect(firstBody.result.structuredContent.analysisRunExpiresAt).toBe("2026-11-16T01:00:00.000Z");
    expect(firstBody.result.structuredContent.scope).toMatchObject({ statuses: ["invited"], participantCount: 1, respondentCount: 1 });
    expect(firstBody.result.structuredContent.questions.map((question) => question.id)).toEqual(["fit"]);
    expect(firstBody.result.structuredContent.methodology.join(" ")).toContain("participant changes during the initial live scan were not isolated");

    const nextOffset = firstBody.result.structuredContent.nextOffset;
    const callsAfterFirstPage = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    const second = await call("analyze_answers", { interviewId, runId: firstBody.result.structuredContent.analysisRunId, offset: nextOffset!, limit: 1 });
    const secondBody = await second.json() as { result: { isError?: boolean; structuredContent: { offset: number; limit: number; nextOffset: number | null; scope: { statuses: string[]; participantCount: number; respondentCount: number }; questions: { id: string; numeric: { mean: number } | null }[] } } };
    expect(secondBody.result.isError).toBeFalsy();
    expect(secondBody.result.structuredContent).toMatchObject({ offset: 1, limit: 1, nextOffset: 2 });
    expect(secondBody.result.structuredContent.scope).toMatchObject({ statuses: ["invited"], participantCount: 1, respondentCount: 1 });
    expect(secondBody.result.structuredContent.questions[0]).toMatchObject({ id: "budget", numeric: { mean: 4, q1: 4, q3: 4 } });
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsAfterFirstPage);

    const third = await call("analyze_answers", { interviewId, runId: firstBody.result.structuredContent.analysisRunId, offset: secondBody.result.structuredContent.nextOffset!, limit: 1 });
    const thirdBody = await third.json() as { result: { isError?: boolean; structuredContent: { offset: number; limit: number; nextOffset: number | null; questions: { id: string }[] } } };
    expect(thirdBody.result.isError).toBeFalsy();
    expect(thirdBody.result.structuredContent).toMatchObject({ offset: 2, limit: 1, nextOffset: null });
    expect(thirdBody.result.structuredContent.questions.map(({ id }) => id)).toEqual(["confidence"]);
  });

  it("keeps segmented singleton and zero-count groups stable across pages", async () => {
    const first = await call("analyze_answers", {
      interviewId,
      segmentBy: "fit",
      statuses: ["invited", "submitted"],
      compareStatuses: true,
      offset: 0,
      limit: 1,
    });
    const firstBody = await first.json() as { result: { isError?: boolean; structuredContent: {
      analysisRunId: string; asOf: string; nextOffset: number | null; scope: { participantCount: number };
      segments: { key: string; participantCount: number; disclosureRisk: { singletonSegment: boolean }; questions: { id: string }[]; statusCohorts: { status: string; questions: { id: string }[] }[] }[];
    } } };
    expect(firstBody.result.isError).toBeFalsy();
    expect(firstBody.result.structuredContent).toMatchObject({ nextOffset: 1, scope: { participantCount: 2 } });
    const zeroCount = firstBody.result.structuredContent.segments.find(({ key }) => key === "answer:no");
    expect(zeroCount).toMatchObject({ participantCount: 0, questions: [{ id: "budget" }] });
    expect(firstBody.result.structuredContent.segments.find(({ key }) => key === "answer:yes")).toMatchObject({
      participantCount: 1,
      disclosureRisk: { singletonSegment: true },
      questions: [{ id: "budget" }],
      statusCohorts: [
        { status: "invited", questions: [{ id: "budget" }] },
        { status: "submitted", questions: [{ id: "budget" }] },
      ],
    });

    const callsAfterFirstPage = vi.mocked(iterateAnalyticsParticipants).mock.calls.length;
    vi.mocked(iterateAnalyticsParticipants).mockImplementation(async function* () {});
    const second = await call("analyze_answers", {
      interviewId,
      runId: firstBody.result.structuredContent.analysisRunId,
      offset: firstBody.result.structuredContent.nextOffset!,
      limit: 1,
    });
    const secondBody = await second.json() as { result: { isError?: boolean; structuredContent: {
      asOf: string; offset: number; nextOffset: number | null; scope: { participantCount: number };
      segments: { key: string; participantCount: number; questions: { id: string; numeric: { mean: number } | null }[]; statusCohorts: { status: string; questions: { id: string }[] }[] }[];
    } } };
    expect(secondBody.result.isError).toBeFalsy();
    expect(secondBody.result.structuredContent).toMatchObject({
      asOf: firstBody.result.structuredContent.asOf,
      offset: 1,
      nextOffset: null,
      scope: { participantCount: 2 },
    });
    expect(secondBody.result.structuredContent.segments.find(({ key }) => key === "answer:no")).toMatchObject({
      participantCount: 0,
      questions: [{ id: "confidence" }],
    });
    expect(secondBody.result.structuredContent.segments.find(({ key }) => key === "answer:yes")).toMatchObject({
      participantCount: 1,
      questions: [{ id: "confidence", distribution: [
        { value: "high", count: 1, percent: 100 },
        { value: "low", count: 0, percent: 0 },
      ] }],
      statusCohorts: [
        { status: "invited", questions: [{ id: "confidence" }] },
        { status: "submitted", questions: [{ id: "confidence", distribution: [
          { value: "high", count: 1, percent: 100 },
          { value: "low", count: 0, percent: 0 },
        ] }] },
      ],
    });
    expect(vi.mocked(iterateAnalyticsParticipants).mock.calls).toHaveLength(callsAfterFirstPage);
  });

  it("rejects empty or conflicting analytics status filters", async () => {
    const empty = await call("analyze_answers", { interviewId, statuses: [] });
    const emptyBody = await empty.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(emptyBody.result.isError).toBe(true);
    expect(emptyBody.result.structuredContent.error).toContain("at least one status");

    const conflict = await call("analyze_answers", { interviewId, submittedOnly: true, statuses: ["invited"] });
    const conflictBody = await conflict.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(conflictBody.result.isError).toBe(true);
    expect(conflictBody.result.structuredContent.error).toContain("cannot be combined");
  });

  it("sends one invite through the mocked SMTP transport", async () => {
    const res = await call("send_invite", { personId });
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { result?: string; to?: string } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.result).toBe("sent");
    expect(body.result.structuredContent.to).toBe("ada@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0].options.port).toBe(587);
    expect(sent[0].options.secure).toBe(false);
    expect(sent[0].options.requireTLS).toBe(true);
    expect(String(sent[0].message.subject)).toContain("Ada Lovelace");
    expect(String(sent[0].message.subject)).toContain("Investor interview");
    expect(String(sent[0].message.text)).toContain("https://kqa.example/person-token");
    expect(String(sent[0].message.text)).not.toContain("data-kqa");
    expect(JSON.stringify(sent[0].message)).not.toContain("test-only-secret");
    expect(JSON.stringify(mailRows)).not.toContain("test-only-secret");
    expect(mailRows).toHaveLength(1);
  });

  it("refuses a bulk send", async () => {
    const res = await call("send_invite", { personIds: [personId] });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { error?: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toMatch(/one person/i);
    expect(sent).toHaveLength(0);
  });

  it("checks delivery through the mocked IMAP client and only for the stored id", async () => {
    await call("send_invite", { personId });
    searches.length = 0;
    const res = await call("check_invite_delivery", { personId });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { delivery?: string; label?: string } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.delivery).toBe("delivered");
    expect(body.result.structuredContent.label).toBe("Delivered");
    expect(JSON.stringify(searches)).toContain("mcp-sent@example.com");
    expect(JSON.stringify(searches)).not.toMatch(/UNSEEN|ALL/);
  });

  it("will not search an arbitrary mailbox", async () => {
    const res = await call("check_invite_delivery", { personId, query: "ALL" });
    const body = await res.json() as { result: { isError?: boolean } };
    expect(body.result.isError).toBe(true);
    expect(searches).toHaveLength(0);
  });
});
