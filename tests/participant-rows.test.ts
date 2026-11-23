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
});
