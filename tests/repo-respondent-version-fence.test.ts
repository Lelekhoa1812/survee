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

function assignPath(target: Record<string, any>, path: string, value: unknown) {
  const parts = path.split(".");
  let at = target;
  for (const part of parts.slice(0, -1)) at = at[part] ??= {};
  at[parts.at(-1)!] = value;
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
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      if (path.includes(".")) assignPath(mocks.participant, path, value);
      else mocks.participant[path] = value;
    }
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

  it("lets respondents reduce legacy over-limit multi answers, but blocks additions and submission until valid", async () => {
    const options = ["a", "b", "c", "d"].map((value) => ({ value, label: value }));
    mocks.versionManifest = { format: "kqa/1", title: "Test", questions: [{ id: "q1", type: "multi", label: "Choices", options, maxSelections: 2 }] };
    mocks.participant.answers = { q1: { value: ["a", "b", "c", "d"], updatedAt: "now" } };

    const add = await asAxion(() => saveAnswers(token, 4, { q1: { value: ["a", "b", "c", "d"] } }));
    expect(add).toMatchObject({ ok: false, status: 400 });

    const reduce = await asAxion(() => saveAnswers(token, 4, { q1: { value: ["a", "b", "c"] } }));
    expect(reduce).toMatchObject({ ok: true });
    mocks.participant.answers.q1.value = ["a", "b", "c"];
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: false, status: 422, code: "incomplete_answers", invalidSelections: [{ id: "q1", selected: 3, maximum: 2 }] });

    const finish = await asAxion(() => saveAnswers(token, 4, { q1: { value: ["a", "b"] } }));
    expect(finish).toMatchObject({ ok: true });
    mocks.participant.answers.q1.value = ["a", "b"];
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true });
  });

  it("autosaves a partial multi minimum, blocks submission until resolved, and permits an optional skip", async () => {
    const options = ["a", "b", "c"].map((value) => ({ value, label: value }));
    mocks.versionManifest = { format: "kqa/1", title: "Test", questions: [{ id: "q1", type: "multi", label: "Choices", options, minSelections: 2 }] };
    const partial = await asAxion(() => saveAnswers(token, 4, { q1: { value: ["a"] } }));
    expect(partial).toMatchObject({ ok: true });
    const saved = mocks.participantUpdate.mock.calls.at(-1)?.[1].$set["answers.q1"];
    expect(saved.value).toEqual(["a"]);
    mocks.participant.answers = { q1: saved };
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({
      ok: false, status: 422, code: "incomplete_answers", invalidMinimumSelections: [{ id: "q1", selected: 1, minimum: 2 }],
    });
    expect(await asAxion(() => saveAnswers(token, 4, { q1: { value: ["a", "b"] } }))).toMatchObject({ ok: true });
    mocks.participant.answers = { q1: { value: ["a", "b"], updatedAt: "now" } };
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true });
    mocks.participant.status = "invited";
    mocks.participant.answers = {};
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true });
  });

  it("rejects new exclusive conflicts, preserves legacy data, and permits correction", async () => {
    const options = ["none", "a", "b"].map((value) => ({ value, label: value }));
    mocks.versionManifest = { format: "kqa/1", title: "Test", questions: [{ id: "q1", type: "multi", label: "Choices", options, exclusiveOptions: ["none"] }] };
    expect(await asAxion(() => saveAnswers(token, 4, { q1: { value: ["none", "a"] } }))).toMatchObject({ ok: false, status: 400 });

    mocks.participant.answers = { q1: { value: ["none", "a"], updatedAt: "now" } };
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: false, status: 422, invalidExclusiveSelections: [{ id: "q1" }] });
    const reduce = await asAxion(() => saveAnswers(token, 4, { q1: { value: ["none"] } }));
    expect(reduce).toMatchObject({ ok: true });
    expect(mocks.participant.answers.q1.value).toEqual(["none"]); // The correction is applied only after its transaction commits.
    const savedSet = mocks.participantUpdate.mock.calls.at(-1)?.[1].$set;
    expect(savedSet["answers.q1"].value).toEqual(["none"]);
  });

  it("saves full rank permutations in respondent order and rejects partial orders", async () => {
    const options = ["a", "b", "c"].map((value) => ({ value, label: value.toUpperCase() }));
    mocks.versionManifest = { format: "kqa/1", title: "Test", questions: [{ id: "q1", type: "rank", label: "Order options", required: true, options }] };
    expect(await asAxion(() => saveAnswers(token, 4, { q1: { value: ["c", "a"] } }))).toMatchObject({ ok: false, status: 400 });
    expect(await asAxion(() => saveAnswers(token, 4, { q1: { value: ["c", "a", "b"] } }))).toMatchObject({ ok: true });
    const savedSet = mocks.participantUpdate.mock.calls.at(-1)?.[1].$set;
    expect(savedSet["answers.q1"].value).toEqual(["c", "a", "b"]);
    mocks.participant.answers = { q1: savedSet["answers.q1"] };
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true, submittedAt: expect.any(String) });
  });

  it("blocks submission of a retained rank that no longer covers the current options", async () => {
    const options = ["a", "b", "c"].map((value) => ({ value, label: value.toUpperCase() }));
    mocks.versionManifest = { format: "kqa/1", title: "Test", questions: [{ id: "q1", type: "rank", label: "Order options", required: false, options }] };
    mocks.participant.answers = { q1: { value: ["c", "a"], updatedAt: "now" } };
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({
      ok: false, status: 422, code: "incomplete_answers", invalidRankSelections: [{ id: "q1" }],
    });
    expect(await asAxion(() => saveAnswers(token, 4, { q1: { value: ["c", "a", "b"] } }))).toMatchObject({ ok: true });
    mocks.participant.answers.q1.value = ["c", "a", "b"];
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true, submittedAt: expect.any(String) });
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

  it("saves stable repeat rows and merges independent field revisions", async () => {
    mocks.versionManifest.questions = [{
      id: "people", type: "repeat", label: "People", maxRows: 2,
      fields: [
        { id: "name", type: "text", label: "Name", required: true },
        { id: "age", type: "number", label: "Age", min: 0 },
      ],
    }];
    const add = await asAxion(() => saveAnswers(token, 4, {}, [{ op: "add", questionId: "people", rowId: "row-1" }]));
    expect(add).toMatchObject({ ok: true, recordGroups: { people: [{ id: "row-1", values: {}, revision: 0, fieldRevisions: {} }] } });

    const name = await asAxion(() => saveAnswers(token, 4, {}, [{ op: "set", questionId: "people", rowId: "row-1", fieldId: "name", expectedFieldRevision: 0, value: "Ada" }]));
    const age = await asAxion(() => saveAnswers(token, 4, {}, [{ op: "set", questionId: "people", rowId: "row-1", fieldId: "age", expectedFieldRevision: 0, value: 42 }]));
    expect(name).toMatchObject({ ok: true });
    expect(age).toMatchObject({ ok: true, recordGroups: { people: [{ id: "row-1", values: { name: "Ada", age: 42 }, revision: 2, fieldRevisions: { name: 1, age: 1 } }] } });
  });

  it("validates follow-ups against saved and same-batch repeat rows", async () => {
    mocks.versionManifest.questions = [
      { id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "name", type: "text", label: "Name" }] },
      { id: "details", type: "text", label: "Details", when: { all: [{ question: "assets", operator: "answered" }] } },
      { id: "none", type: "text", label: "No assets", when: { all: [{ question: "assets", operator: "notAnswered" }] } },
      { id: "extra", type: "repeat", label: "Extra records", maxRows: 1, fields: [{ id: "name", type: "text", label: "Name" }], when: { all: [{ question: "assets", operator: "answered" }] } },
    ];
    expect(await asAxion(() => saveAnswers(token, 4, { details: { value: "unavailable" } }))).toMatchObject({ ok: false, status: 400 });
    expect(await asAxion(() => saveAnswers(token, 4, { details: { value: "same batch" } }, [
      { op: "add", questionId: "assets", rowId: "asset-1" },
      { op: "add", questionId: "extra", rowId: "extra-1" },
    ]))).toMatchObject({ ok: true });
    expect(await asAxion(() => saveAnswers(token, 4, { details: { value: "saved row" } }))).toMatchObject({ ok: true });
    expect(await asAxion(() => saveAnswers(token, 4, { none: { value: "incorrect" } }))).toMatchObject({ ok: false, status: 400 });
    expect(await asAxion(() => saveAnswers(token, 4, { details: { value: "hidden" } }, [{ op: "remove", questionId: "assets", rowId: "asset-1", expectedRowRevision: 0 }]))).toMatchObject({ ok: false, status: 400 });
    expect(mocks.participant.recordGroups.assets[0].deletedAt).toBeUndefined();
    expect(await asAxion(() => saveAnswers(token, 4, { none: { value: "now empty" } }, [{ op: "remove", questionId: "assets", rowId: "asset-1", expectedRowRevision: 0 }]))).toMatchObject({ ok: true });
  });

  it("rejects stale same-field writes, stale row removals, and adds above maxRows", async () => {
    mocks.versionManifest.questions = [{ id: "items", type: "repeat", label: "Items", maxRows: 1, fields: [{ id: "label", type: "text", label: "Label" }] }];
    await asAxion(() => saveAnswers(token, 4, {}, [{ op: "add", questionId: "items", rowId: "row-1" }]));
    await asAxion(() => saveAnswers(token, 4, {}, [{ op: "set", questionId: "items", rowId: "row-1", fieldId: "label", expectedFieldRevision: 0, value: "first" }]));
    expect(await asAxion(() => saveAnswers(token, 4, {}, [{ op: "set", questionId: "items", rowId: "row-1", fieldId: "label", expectedFieldRevision: 0, value: "stale" }]))).toMatchObject({ ok: false, status: 409, code: "record_field_conflict" });
    expect(await asAxion(() => saveAnswers(token, 4, {}, [{ op: "add", questionId: "items", rowId: "row-2" }]))).toMatchObject({ ok: false, status: 400, recordErrors: [{ questionId: "items", rowId: "row-2" }] });
    expect(await asAxion(() => saveAnswers(token, 4, {}, [{ op: "remove", questionId: "items", rowId: "row-1", expectedRowRevision: 0 }]))).toMatchObject({ ok: false, status: 409, code: "record_row_conflict" });
    expect(mocks.participant.recordGroups?.items).toHaveLength(1);
  });

  it("makes committed record operations idempotent while retaining non-reusable row tombstones", async () => {
    mocks.versionManifest.questions = [{ id: "items", type: "repeat", label: "Items", maxRows: 1, fields: [{ id: "label", type: "text", label: "Label" }] }];
    const add = [{ op: "add" as const, questionId: "items", rowId: "row-1" }];
    await asAxion(() => saveAnswers(token, 4, {}, add));
    expect(await asAxion(() => saveAnswers(token, 4, {}, add))).toMatchObject({ ok: true });
    const set = [{ op: "set" as const, questionId: "items", rowId: "row-1", fieldId: "label", expectedFieldRevision: 0, value: "one" }];
    await asAxion(() => saveAnswers(token, 4, {}, set));
    expect(await asAxion(() => saveAnswers(token, 4, {}, set))).toMatchObject({ ok: true });
    const remove = [{ op: "remove" as const, questionId: "items", rowId: "row-1", expectedRowRevision: 1 }];
    await asAxion(() => saveAnswers(token, 4, {}, remove));
    expect(await asAxion(() => saveAnswers(token, 4, {}, remove))).toMatchObject({ ok: true, recordGroups: { items: [] } });
    expect(mocks.participant.recordGroups?.items[0]).toMatchObject({ id: "row-1", deletedAt: expect.any(String), values: {} });
    expect(await asAxion(() => saveAnswers(token, 4, {}, [{ op: "add", questionId: "items", rowId: "row-1" }]))).toMatchObject({ ok: false, status: 409, code: "record_row_conflict" });
    expect(await asAxion(() => saveAnswers(token, 4, {}, [{ op: "add", questionId: "items", rowId: "row-2" }]))).toMatchObject({ ok: true });
  });

  it("validates required repeat rows and fields inside the submit transaction", async () => {
    mocks.versionManifest.questions = [{
      id: "jobs", type: "repeat", label: "Jobs", required: true, minRows: 1, maxRows: 3,
      fields: [{ id: "title", type: "text", label: "Title", required: true }],
    }];
    await asAxion(() => saveAnswers(token, 4, {}, [{ op: "add", questionId: "jobs", rowId: "job-1" }]));
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: false, status: 422, repeatErrors: [{ questionId: "jobs", rowId: "job-1", fieldId: "title" }] });
    await asAxion(() => saveAnswers(token, 4, {}, [{ op: "set", questionId: "jobs", rowId: "job-1", fieldId: "title", expectedFieldRevision: 0, value: "Research" }]));
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true });
  });

  it("submits against a repeat row saved after the initial token lookup", async () => {
    mocks.versionManifest.questions = [{ id: "assets", type: "repeat", label: "Assets", required: true, maxRows: 2, fields: [{ id: "name", type: "text", label: "Name", required: true }] }];
    mocks.beforeTransaction = () => {
      mocks.participant.recordGroups = { assets: [{ id: "asset-1", values: { name: "Pump" }, revision: 1, fieldRevisions: { name: 1 } }] };
      mocks.participant.revision++;
    };
    expect(await asAxion(() => submitAnswers(token, 4))).toMatchObject({ ok: true });
  });
});
