import { describe, expect, it } from "vitest";
import { participantRows } from "../src/lib/host/participant-rows";
import type { Manifest } from "../src/lib/format/schema";
import type { ParticipantView } from "../src/lib/repo/types";

const person = {
  id: "person-1", interviewId: "interview-1", token: "respondent-token", name: "Ada", status: "in_progress",
  answers: { q1: { value: "ready", note: "private detail", updatedAt: "2026-11-23T00:00:00.000Z" } },
  recordGroups: { rows: [{ id: "row-1", values: { name: "private row" }, revision: 1, fieldRevisions: {} }] },
  questionOrderAssignments: [{ surveyVersion: 1, algorithmVersion: "v1", groups: {}, assignedAt: "2026-11-23T00:00:00.000Z" }],
  revision: 1, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
} as unknown as ParticipantView;

const manifest = {
  questions: [{ id: "q1", type: "text", required: true }],
} as unknown as Manifest;

describe("participant host rows", () => {
  it("keeps progress while omitting raw answers, repeat records, and assignment history", () => {
    const [row] = participantRows(manifest, [person], [], false);

    expect(row).toMatchObject({ answered: 1, total: 1, requiredMissing: 0, answers: {} });
    expect(row).not.toHaveProperty("recordGroups");
    expect(row).not.toHaveProperty("questionOrderAssignments");
  });

  it("includes answer details for the Answers tab", () => {
    const [row] = participantRows(manifest, [person], []);

    expect(row.answers.q1?.value).toBe("ready");
    expect(row.recordGroups?.rows).toHaveLength(1);
    expect(row.questionOrderAssignments).toHaveLength(1);
  });

  it("keeps old-token ambiguous attempts reachable after a host rotates the link", () => {
    const [row] = participantRows(manifest, [person], [{
      id: "attempt-old", participantId: person.id, to: "old@example.test", token: "old-token", status: "pending",
      sentAt: "2026-11-23T00:00:00.000Z", delivery: "unknown", pendingAttemptCount: 1,
    }]);
    expect(row.mail).toMatchObject({ state: "unsent", pendingAttemptCount: 1, pendingAttempts: [{ attemptId: "attempt-old", email: "old@example.test" }] });
  });

  it("does not associate a different participant's mail attempt when link tokens match", () => {
    const [row] = participantRows(manifest, [person], [{
      id: "other-participant-attempt", participantId: "cccccccccccccccccccccccc", to: "other@example.test", token: person.token,
      status: "sent", sentAt: "2026-11-23T00:00:00.000Z", delivery: "delivered",
    }]);
    expect(row.mail.state).toBe("unsent");
    expect(row.mail.pendingAttempts).toEqual([]);
  });

  it("marks a repeat question incomplete when a retained row fails required-field validation", () => {
    const repeatManifest = {
      format: "kqa/1", title: "Records", questions: [{
        id: "jobs", type: "repeat", label: "Jobs", required: true, maxRows: 3,
        fields: [{ id: "title", type: "text", label: "Title", required: true }],
      }],
    } as unknown as Manifest;
    const respondent = { ...person, answers: {}, recordGroups: { jobs: [{ id: "row-1", values: {}, revision: 0, fieldRevisions: {} }] } } as ParticipantView;

    const [row] = participantRows(repeatManifest, [respondent], [], false);

    expect(row).toMatchObject({ answered: 0, total: 1, requiredMissing: 1 });
  });
});
