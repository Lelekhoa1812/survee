import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const sent: { message: Record<string, unknown>; options: { port?: number; secure?: boolean; requireTLS?: boolean } }[] = [];
const searches: unknown[] = [];

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
  ],
};

vi.mock("../src/lib/repo", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/repo")>("../src/lib/repo");
  return {
    ...actual,
    noteMcp: vi.fn(async () => {}),
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
    getVersion: vi.fn(async () => ({ version: 1, manifest: analyticsManifest })),
    listParticipants: vi.fn(async () => [
      { id: personId, name: "Ada Lovelace", status: "submitted", answers: { fit: { value: "yes", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 2, updatedAt: "2026-11-13T00:00:00.000Z" } } },
      { id: anotherPersonId, name: "Grace Hopper", status: "invited", answers: { fit: { value: "retired", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 4, updatedAt: "2026-11-13T00:00:00.000Z" } } },
    ]),
    iterateAnalyticsParticipants: vi.fn(async function* (_id: string, _questionIds: string[], scope: { statuses?: ("invited" | "in_progress" | "submitted")[] } = {}) {
      const people = [
        { status: "submitted" as const, answers: { fit: { value: "yes", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 2, updatedAt: "2026-11-13T00:00:00.000Z" } } },
        { status: "invited" as const, answers: { fit: { value: "retired", updatedAt: "2026-11-13T00:00:00.000Z" }, budget: { value: 4, updatedAt: "2026-11-13T00:00:00.000Z" } } },
      ];
      for (const person of people) if (!scope.statuses || scope.statuses.includes(person.status)) yield person;
    }),
  };
});

import { handleMcp } from "../src/lib/mcp/http";
import { listToolDefs } from "../src/lib/mcp/tools";
import { MCP_TOOL_CAPABILITIES } from "../src/lib/mcp/capabilities";

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
  sent.length = 0;
  searches.length = 0;
});

describe("MCP tools", () => {
  it("documents every registered tool", () => {
    const md = readFileSync(new URL("../docs/MCP.md", import.meta.url), "utf8");
    const tools = listToolDefs();
    for (const tool of tools) expect(md).toContain(`\`${tool.name}\``);
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(MCP_TOOL_CAPABILITIES).sort());
    expect(tools.every((tool) => tool.annotations && typeof tool.annotations.readOnlyHint === "boolean")).toBe(true);
    expect(tools.find((tool) => tool.name === "delete_interview")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.find((tool) => tool.name === "send_invite")?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  });

  it("returns sourced design guidance for the requested product surface", async () => {
    const res = await call("get_design_guidance", { surface: "questionnaire" });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { policyVersion?: string; principles?: { id: string }[]; sources?: { name: string }[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.policyVersion).toBe("kqa-design/2");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("question-clarity");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("response-options");
    expect(body.result.structuredContent.principles?.map((p) => p.id)).toContain("pretest");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("WCAG 2.2 Quick Reference");
    expect(body.result.structuredContent.sources?.map((source) => source.name)).toContain("Pew Research Center: Writing Survey Questions");
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
    expect(body.result.structuredContent.limits?.join(" ")).toContain("cannot verify rendered contrast");
    expect(body.result.structuredContent.limits?.join(" ")).toContain("cannot judge question wording");
  });

  it("returns scoped descriptive summaries without raw answers", async () => {
    const res = await call("analyze_answers", { interviewId, submittedOnly: false });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { surveyVersion?: number; scope?: { respondentCount: number }; questions?: { id: string; answeredCount: number; unmappedResponseCount: number; numeric: { mean: number } | null }[]; methodology?: string[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.surveyVersion).toBe(1);
    expect(body.result.structuredContent.scope?.respondentCount).toBe(2);
    const fit = body.result.structuredContent.questions?.find((question) => question.id === "fit");
    expect(fit).toMatchObject({ answeredCount: 2, unmappedResponseCount: 1 });
    const budget = body.result.structuredContent.questions?.find((question) => question.id === "budget");
    expect(budget?.numeric).toMatchObject({ n: 2, mean: 3, median: 3 });
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("retired");
    expect(body.result.structuredContent.methodology?.join(" ")).toContain("multi-select");
  });

  it("narrows analytics to selected statuses", async () => {
    const res = await call("analyze_answers", { interviewId, statuses: ["invited"] });
    const body = await res.json() as { result: { isError?: boolean; structuredContent: { scope?: { statuses: string[]; respondentCount: number; submittedCount: number }; questions?: { id: string; answeredCount: number; unmappedResponseCount: number }[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.scope).toMatchObject({ statuses: ["invited"], respondentCount: 1, submittedCount: 0, submittedOnly: false });
    expect(body.result.structuredContent.questions?.find((question) => question.id === "fit")).toMatchObject({ answeredCount: 1, unmappedResponseCount: 1 });
  });

  it("paginates analytics questions and keeps the requested cohort on each page", async () => {
    const first = await call("analyze_answers", { interviewId, statuses: ["invited"], offset: 0, limit: 1 });
    const firstBody = await first.json() as { result: { isError?: boolean; structuredContent: { offset: number; limit: number; questionCount: number; nextOffset: number | null; scope: { statuses: string[]; respondentCount: number }; questions: { id: string }[] } } };
    expect(firstBody.result.isError).toBeFalsy();
    expect(firstBody.result.structuredContent).toMatchObject({ offset: 0, limit: 1, questionCount: 2, nextOffset: 1 });
    expect(firstBody.result.structuredContent.scope).toMatchObject({ statuses: ["invited"], respondentCount: 1 });
    expect(firstBody.result.structuredContent.questions.map((question) => question.id)).toEqual(["fit"]);

    const nextOffset = firstBody.result.structuredContent.nextOffset;
    const second = await call("analyze_answers", { interviewId, statuses: ["invited"], offset: nextOffset!, limit: 1 });
    const secondBody = await second.json() as { result: { isError?: boolean; structuredContent: { offset: number; limit: number; nextOffset: number | null; scope: { statuses: string[]; respondentCount: number }; questions: { id: string; numeric: { mean: number } | null }[] } } };
    expect(secondBody.result.isError).toBeFalsy();
    expect(secondBody.result.structuredContent).toMatchObject({ offset: 1, limit: 1, nextOffset: null });
    expect(secondBody.result.structuredContent.scope).toMatchObject({ statuses: ["invited"], respondentCount: 1 });
    expect(secondBody.result.structuredContent.questions[0]).toMatchObject({ id: "budget", numeric: { mean: 4 } });
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
