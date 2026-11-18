import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentVersion: 4,
  interviewStatus: "open",
  participant: {} as Record<string, any>,
  interviewId: {} as any,
  participantId: {} as any,
  versionManifest: {} as Record<string, any>,
  events: [] as string[],
  session: { transaction: true },
  publishBeforeTransaction: false,
  beforeTransaction: undefined as (() => void) | undefined,
  fenceUpdate: vi.fn(),
  participantUpdate: vi.fn(),
  withMongoTransaction: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({
      findOne: async () => mocks.participant,
      findOneAndUpdate: mocks.participantUpdate,
    }),
    interviews: async () => ({
      findOne: async (filter: Record<string, any>) => {
        const fields = Object.assign({}, ...(Array.isArray(filter.$and) ? filter.$and : [filter]));
        if (fields.currentVersion !== undefined && fields.currentVersion !== mocks.currentVersion) return null;
        return { _id: mocks.interviewId, currentVersion: mocks.currentVersion, status: mocks.interviewStatus };
      },
      updateOne: mocks.fenceUpdate,
    }),
    versions: async () => ({ findOne: async () => ({ version: mocks.currentVersion, manifest: mocks.versionManifest }) }),
    events: async () => ({ insertOne: async (event: Record<string, unknown>) => { mocks.events.push(String(event.type)); } }),
  },
}));

import { saveAnswers, submitAnswers } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const token = "A".repeat(24);
const question = { id: "q1", type: "text", label: "Answer", required: false };

function fields(filter: Record<string, any>) {
  return Object.assign({}, ...(Array.isArray(filter.$and) ? filter.$and : [filter]));
}

beforeEach(() => {
  mocks.currentVersion = 4;
  mocks.interviewStatus = "open";
  mocks.interviewId = new ObjectId();
  mocks.participantId = new ObjectId();
  mocks.versionManifest = { format: "kqa/1", title: "Test", questions: [question] };
  mocks.participant = {
    _id: mocks.participantId,
    tenantId: "axion",
    interviewId: mocks.interviewId,
    token,
    name: "Alex",
    status: "invited",
    answers: {},
    revision: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  mocks.events.length = 0;
  mocks.publishBeforeTransaction = false;
  mocks.beforeTransaction = undefined;
  mocks.fenceUpdate.mockReset().mockImplementation(async (filter: Record<string, any>, _update: unknown, options: Record<string, any>) => {
    mocks.events.push("fence");
    expect(options.session).toBe(mocks.session);
    const f = fields(filter);
    const matched = f.currentVersion === mocks.currentVersion && f.status === mocks.interviewStatus && mocks.interviewStatus === "open";
    return { matchedCount: matched ? 1 : 0, modifiedCount: matched ? 1 : 0 };
  });
  mocks.participantUpdate.mockReset().mockImplementation(async (filter: Record<string, any>, update: Record<string, any>, options: Record<string, any>) => {
    mocks.events.push("participant");
    expect(options.session).toBe(mocks.session);
    const f = fields(filter);
    if (f.revision !== undefined && f.revision !== mocks.participant.revision) return null;
    if (mocks.participant.status === "submitted") return null;
    Object.assign(mocks.participant, update.$set);
    mocks.participant.revision += update.$inc?.revision ?? 0;
    return { ...mocks.participant };
  });
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work: (session: unknown) => Promise<unknown>) => {
    if (mocks.publishBeforeTransaction) mocks.currentVersion = 5;
    mocks.beforeTransaction?.();
    return work(mocks.session);
  });
});

const asAxion = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, work);

describe("respondent version fence", () => {
  it("writes answers through the same transaction fence used by publication", async () => {
    const result = await asAxion(() => saveAnswers(token, 4, { q1: { value: "current answer" } }));

    expect(result).toMatchObject({ ok: true, revision: 1, status: "in_progress" });
    expect(mocks.events.slice(0, 2)).toEqual(["fence", "participant"]);
    expect(mocks.fenceUpdate).toHaveBeenCalledOnce();
    expect(mocks.participantUpdate).toHaveBeenCalledOnce();
  });

  it("rejects a save when publication wins before the transaction fence", async () => {
    mocks.publishBeforeTransaction = true;

    const result = await asAxion(() => saveAnswers(token, 4, { q1: { value: "stale answer" } }));

    expect(result).toMatchObject({ ok: false, status: 409, code: "questionnaire_version_changed" });
    expect(mocks.participantUpdate).not.toHaveBeenCalled();
  });

  it("submits only after touching the same transaction fence", async () => {
    const result = await asAxion(() => submitAnswers(token, 4));

    expect(result).toMatchObject({ ok: true, submittedAt: expect.any(String) });
    expect(mocks.events.slice(0, 2)).toEqual(["fence", "participant"]);
    expect(mocks.fenceUpdate).toHaveBeenCalledOnce();
    expect(mocks.participantUpdate).toHaveBeenCalledOnce();
  });

  it("returns a version conflict before opening a transaction when the page is already stale", async () => {
    mocks.currentVersion = 5;

    const result = await asAxion(() => submitAnswers(token, 4));

    expect(result).toMatchObject({ ok: false, status: 409, code: "questionnaire_version_changed" });
    expect(mocks.withMongoTransaction).not.toHaveBeenCalled();
    expect(mocks.participantUpdate).not.toHaveBeenCalled();
  });

  it("checks the answers saved after the initial read before submitting", async () => {
    mocks.versionManifest.questions = [{ ...question, required: true }];
    mocks.participant.answers = { q1: { value: "Initially answered", updatedAt: new Date().toISOString() } };
    mocks.beforeTransaction = () => { mocks.participant.answers = {}; mocks.participant.revision++; };

    const result = await asAxion(() => submitAnswers(token, 4));

    expect(result).toMatchObject({ ok: false, status: 422, missing: [{ id: "q1" }] });
    expect(mocks.participantUpdate).not.toHaveBeenCalled();
    expect(mocks.participant.status).toBe("invited");
  });

  it("accepts a required answer saved after the initial read", async () => {
    mocks.versionManifest.questions = [{ ...question, required: true }];
    mocks.beforeTransaction = () => {
      mocks.participant.answers = { q1: { value: "Saved", updatedAt: new Date().toISOString() } };
      mocks.participant.revision++;
    };

    const result = await asAxion(() => submitAnswers(token, 4));

    expect(result).toMatchObject({ ok: true });
    expect(fields(mocks.participantUpdate.mock.calls[0][0]).revision).toBe(1);
    expect(mocks.participant.status).toBe("submitted");
  });

  it("returns the first submission timestamp when another submit wins the fence", async () => {
    const submittedAt = new Date("2026-11-19T00:00:00Z");
    mocks.beforeTransaction = () => { mocks.participant.status = "submitted"; mocks.participant.submittedAt = submittedAt; };

    const result = await asAxion(() => submitAnswers(token, 4));

    expect(result).toEqual({ ok: true, submittedAt: submittedAt.toISOString() });
    expect(mocks.participantUpdate).not.toHaveBeenCalled();
    expect(mocks.events).not.toContain("submit");
  });

  it("does not submit if the validated revision no longer matches", async () => {
    mocks.participantUpdate.mockImplementationOnce(async () => { mocks.participant.revision++; return null; });

    const result = await asAxion(() => submitAnswers(token, 4));

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(fields(mocks.participantUpdate.mock.calls[0][0]).revision).toBe(0);
    expect(mocks.participant.status).toBe("invited");
  });

  it("rejects direct writes to an ineligible routed question", async () => {
    mocks.versionManifest.questions = [
      { id: "kind", type: "single", label: "Kind", options: [{ value: "person", label: "Person" }, { value: "org", label: "Organisation" }] },
      { id: "org-details", type: "text", label: "Organisation details", when: { all: [{ question: "kind", operator: "equals", value: "org" }] } },
    ];
    mocks.participant.answers = { kind: { value: "person", updatedAt: new Date().toISOString() } };

    const result = await asAxion(() => saveAnswers(token, 4, { "org-details": { value: "Private data" } }));

    expect(result).toMatchObject({ ok: false, status: 400, details: [{ id: "org-details", reason: expect.stringContaining("not available") }] });
    expect(mocks.participantUpdate).not.toHaveBeenCalled();
  });

  it("allows changing a route parent while retaining the now-inactive prior answer", async () => {
    mocks.versionManifest.questions = [
      { id: "kind", type: "single", label: "Kind", options: [{ value: "person", label: "Person" }, { value: "org", label: "Organisation" }] },
      { id: "org-details", type: "text", label: "Organisation details", when: { all: [{ question: "kind", operator: "equals", value: "org" }] } },
    ];
    mocks.participant.answers = {
      kind: { value: "org", updatedAt: new Date().toISOString() },
      "org-details": { value: "Earlier answer", updatedAt: new Date().toISOString() },
    };

    const result = await asAxion(() => saveAnswers(token, 4, { kind: { value: "person" } }));

    expect(result).toMatchObject({ ok: true });
    expect(mocks.participantUpdate).toHaveBeenCalledOnce();
  });
});
