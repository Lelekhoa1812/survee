import { describe, expect, it } from "vitest";
import { assignQuestionOrder, presentedQuestionIds } from "../src/lib/format/question-order";
import type { Manifest } from "../src/lib/format/schema";

const manifest = {
  format: "kqa/1",
  title: "Ordering",
  questionOrderGroups: [{ id: "context-pair", questionIds: ["first", "second", "third"] }],
  questions: ["intro", "first", "second", "third", "anchor"].map((id) => ({ id, type: "text", label: id })),
} as Manifest;

describe("question order assignments", () => {
  it("is stable for the same participant, version and group", () => {
    const first = assignQuestionOrder(manifest, "participant-1", 4);
    expect(assignQuestionOrder(manifest, "participant-1", 4)).toEqual(first);
    expect(first.algorithmVersion).toBe("kqa-question-order-v1");
  });

  it("varies with participant and immutable survey version", () => {
    const participantOrders = new Set(Array.from({ length: 24 }, (_, index) => assignQuestionOrder(manifest, `participant-${index}`, 4).groups["context-pair"].join(",")));
    const versionOrders = new Set(Array.from({ length: 24 }, (_, index) => assignQuestionOrder(manifest, "participant-1", index).groups["context-pair"].join(",")));
    expect(participantOrders.size).toBeGreaterThan(1);
    expect(versionOrders.size).toBeGreaterThan(1);
  });

  it("changes only explicitly grouped positions and preserves every question", () => {
    const assignment = { algorithmVersion: "older", groups: { "context-pair": ["third", "first", "second"] } };
    expect(presentedQuestionIds(manifest, assignment)).toEqual(["intro", "third", "first", "second", "anchor"]);
  });

  it("fails closed to authored order when a stored assignment is incomplete or invalid", () => {
    expect(presentedQuestionIds(manifest, { algorithmVersion: "old", groups: {} })).toEqual(["intro", "first", "second", "third", "anchor"]);
    expect(presentedQuestionIds(manifest, { algorithmVersion: "old", groups: { "context-pair": ["third", "third", "first"] } })).toEqual(["intro", "first", "second", "third", "anchor"]);
  });
});
