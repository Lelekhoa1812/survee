import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/lib/format/schema";
import { compareVersions, createCompatibilityAccumulator } from "../src/lib/diagnostics/compat";

const manifest = (questions: Manifest["questions"]): Manifest => ({ format: "kqa/1", title: "Survey", questions });

describe("compareVersions", () => {
  it("keeps streamed accumulator results identical to the compatibility helper", () => {
    const previous = manifest([{ id: "q", type: "multi", label: "Choices", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }]);
    const next = manifest([{ id: "q", type: "multi", label: "Choices", maxSelections: 1, options: [{ value: "a", label: "A" }] }]);
    const answers = [
      { status: "in_progress", answers: { q: { value: ["a", "b"], updatedAt: "now" } } },
      { status: "submitted", answers: { q: { value: "b", note: "context", updatedAt: "now" } } },
    ];
    const accumulator = createCompatibilityAccumulator(previous, next);
    for (const answer of answers) accumulator.add(answer);
    expect(accumulator.finish()).toEqual(compareVersions({ previous, next, answers }));
  });

  it("warns when the respondent flow changes after answers are saved", () => {
    const previous: Manifest = { ...manifest([{ id: "q", type: "text", label: "Prompt" }]), presentation: "all" };
    const next: Manifest = { ...previous, presentation: "guided-question" };
    const diagnostics = compareVersions({ previous, next, answers: [
      { status: "open", answers: { q: { value: "A response", updatedAt: "now" } } },
      { status: "submitted", answers: {} },
    ] });
    expect(diagnostics.filter((item) => item.code === "KQA710").map((item) => item.message)).toEqual([
      'The respondent presentation changed from "all" to "guided-question" while 1 person has saved answers. Their data remains attached to the same questions, but the changed flow may affect context and burden.',
    ]);
  });

  it("does not warn about a presentation change before anyone has answered", () => {
    const previous: Manifest = { ...manifest([{ id: "q", type: "text", label: "Prompt" }]), presentation: "guided" };
    const next: Manifest = { ...previous, presentation: "guided-question" };
    const diagnostics = compareVersions({ previous, next, answers: [{ status: "open", answers: {} }] });
    expect(diagnostics.some((item) => item.code === "KQA710")).toBe(false);
  });

  it("warns when option presentation changes for answered questions", () => {
    const previous = manifest([{ id: "q", type: "single", label: "Choices", options: ["a", "b", "c"].map((value) => ({ value, label: value })) }]);
    const next = manifest([{ id: "q", type: "single", label: "Choices", randomizeOptions: true, fixedOptionValues: ["c"], options: ["a", "b", "c"].map((value) => ({ value, label: value })) }]);
    const diagnostics = compareVersions({ previous, next, answers: [{ status: "open", answers: { q: { value: "a", updatedAt: "now" } } }] });
    expect(diagnostics.filter((item) => item.code === "KQA708")).toHaveLength(1);
  });

  it("warns when newly exclusive options conflict with retained answers", () => {
    const previous = manifest([{ id: "q", type: "multi", label: "Choices", options: ["none", "one", "two"].map((value) => ({ value, label: value })) }]);
    const next = manifest([{ id: "q", type: "multi", label: "Choices", exclusiveOptions: ["none"], options: ["none", "one", "two"].map((value) => ({ value, label: value })) }]);
    const diagnostics = compareVersions({ previous, next, answers: [
      { status: "open", answers: { q: { value: ["none", "one"], updatedAt: "now" } } },
      { status: "submitted", answers: { q: { value: ["one", "two"], updatedAt: "now" } } },
    ] });
    expect(diagnostics.filter((item) => item.code === "KQA706").map((item) => item.message)).toEqual([
      'Question "q" now has exclusive options, but 1 person has already saved conflicting choices.',
    ]);
  });

  it("warns once per person when retained multi answers exceed a lowered cap", () => {
    const previous = manifest([{ id: "q", type: "multi", label: "Choices", options: ["a", "b", "c", "d"].map((value) => ({ value, label: value })) }]);
    const next = manifest([{ id: "q", type: "multi", label: "Choices", maxSelections: 2, options: ["a", "b", "c"].map((value) => ({ value, label: value })) }]);
    const diagnostics = compareVersions({ previous, next, answers: [
      { status: "open", answers: { q: { value: ["a", "b", "c", "d"], updatedAt: "now" } } },
      { status: "open", answers: { q: { value: ["a", "b", "c", "c"], updatedAt: "now" } } },
      { status: "open", answers: { q: { value: ["a", "d"], updatedAt: "now" } } },
    ] });
    expect(diagnostics.filter((d) => d.code === "KQA705").map((d) => d.message)).toEqual([
      'Question "q" now allows at most 2 choices, but 2 people have already saved more.',
    ]);
  });

  it("warns when a new minimum makes already saved partial choices incomplete", () => {
    const previous = manifest([{ id: "q", type: "multi", label: "Choices", options: ["a", "b", "c"].map((value) => ({ value, label: value })) }]);
    const next = manifest([{ id: "q", type: "multi", label: "Choices", minSelections: 2, options: ["a", "b", "c"].map((value) => ({ value, label: value })) }]);
    const diagnostics = compareVersions({ previous, next, answers: [
      { status: "open", answers: { q: { value: ["a"], updatedAt: "now" } } },
      { status: "submitted", answers: { q: { value: ["a", "b"], updatedAt: "now" } } },
      { status: "open", answers: { q: { value: [], updatedAt: "now" } } },
    ] });
    expect(diagnostics.filter((d) => d.code === "KQA707").map((d) => d.message)).toEqual([
      'Question "q" now requires at least 2 choices when answered, but 1 person has already saved fewer.',
    ]);
  });

  it("keeps compatibility diagnostics and participant counting semantics", () => {
    const previous = manifest([
      { id: "qgone", type: "text", label: "Removed prompt" },
      { id: "qrename", type: "text", label: "New prompt" },
      { id: "qchoice", type: "single", label: "Choice", options: [{ value: "kept", label: "Kept" }, { value: "removed", label: "Removed" }] },
      { id: "qmulti", type: "multi", label: "Multi", options: [{ value: "kept", label: "Kept" }, { value: "gone", label: "Gone" }, { value: "other", label: "Other" }] },
      { id: "qtype", type: "text", label: "Changed type" },
      { id: "qempty", type: "text", label: "Empty answer" },
      { id: "qnewrequired", type: "text", label: "Now required", required: false },
    ]);
    const next = manifest([
      { id: "qchoice", type: "single", label: "Choice", options: [{ value: "kept", label: "Kept" }] },
      { id: "qmulti", type: "multi", label: "Multi", options: [{ value: "kept", label: "Kept" }] },
      { id: "qtype", type: "number", label: "Changed type" },
      { id: "qrenamed", type: "text", label: "  NEW PROMPT  " },
      { id: "qnewrequired", type: "text", label: "Now required", required: true },
    ]);

    const diagnostics = compareVersions({
      previous,
      next,
      answers: [
        {
          status: "submitted",
          answers: {
            qgone: { value: "answer", updatedAt: "now" },
            qchoice: { value: "removed", updatedAt: "now" },
            qmulti: { value: ["gone", "gone", "other"], updatedAt: "now" },
            qtype: { note: "note only", updatedAt: "now" },
            qempty: { note: "", updatedAt: "now" },
          },
        },
        {
          status: "open",
          answers: {
            qgone: { note: "note only", updatedAt: "now" },
            qchoice: { value: "kept", updatedAt: "now" },
            qmulti: { value: ["gone"], updatedAt: "now" },
            qtype: { value: "answer", updatedAt: "now" },
            qempty: { updatedAt: "now" },
          },
        },
        {
          status: "submitted",
          answers: {
            qgone: { note: "", updatedAt: "now" },
            qchoice: { value: "removed", updatedAt: "now" },
            qmulti: { value: "other", updatedAt: "now" },
            qtype: { note: "", updatedAt: "now" },
          },
        },
      ],
    });

    expect(diagnostics.map(({ code, message }) => [code, message])).toEqual([
      ["KQA700", 'Question "qgone" ("Removed prompt") is not in the new version, and 2 people have answered it.'],
      ["KQA703", '"qrename" is gone and "qrenamed" is new, with the same label "New prompt". If this is a rename, answers will not follow it.'],
      ["KQA702", 'Option "removed" ("Removed") of "qchoice" is not in the new version, but 2 people chose it.'],
      ["KQA702", 'Option "gone" ("Gone") of "qmulti" is not in the new version, but 2 people chose it.'],
      ["KQA702", 'Option "other" ("Other") of "qmulti" is not in the new version, but 2 people chose it.'],
      ["KQA701", 'Question "qtype" changed from "text" to "number", and 2 saved answers use the old type.'],
      ["KQA704", '"qnewrequired" is required in the new version, and 2 people have already submitted without it.'],
    ]);
  });

  it("does not count an empty string as option use, but counts an explicitly stored answer value", () => {
    const previous = manifest([
      { id: "q", type: "single", label: "Choice", options: [{ value: "old", label: "Old" }, { value: "keep", label: "Keep" }] },
      { id: "qremoved", type: "text", label: "Removed" },
    ]);
    const next = manifest([{ id: "q", type: "single", label: "Choice", options: [{ value: "keep", label: "Keep" }] }]);
    const diagnostics = compareVersions({
      previous,
      next,
      answers: [
        { status: "open", answers: { q: { value: "", updatedAt: "now" }, qremoved: { value: "", updatedAt: "now" } } },
        { status: "open", answers: { q: { value: "old", updatedAt: "now" } } },
        { status: "open", answers: { q: { updatedAt: "now" } } },
      ],
    });
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Option "old" ("Old") of "q" is not in the new version, but 1 person chose it.',
      'Question "qremoved" ("Removed") is not in the new version, and 1 person has answered it.',
    ]);
  });

  it("warns when a saved repeated field is removed or the active row count exceeds a lowered cap", () => {
    const previous = manifest([{ id: "assets", type: "repeat", label: "Assets", maxRows: 5, fields: [
      { id: "name", type: "text", label: "Asset name" },
      { id: "condition", type: "text", label: "Condition" },
    ] }]);
    const next = manifest([{ id: "assets", type: "repeat", label: "Assets", maxRows: 1, fields: [
      { id: "name", type: "text", label: "Asset name" },
    ] }]);
    const diagnostics = compareVersions({ previous, next, answers: [{ status: "in_progress", answers: {}, recordGroups: { assets: [
      { id: "r1", values: { name: "A-1", condition: "good" }, revision: 0, fieldRevisions: {} },
      { id: "r2", values: { name: "A-2" }, revision: 0, fieldRevisions: {} },
    ] } }] });
    expect(diagnostics.filter((item) => item.code === "KQA709")).toHaveLength(1);
    expect(diagnostics.find((item) => item.code === "KQA709")?.message).toContain("1 person may no longer fit");
  });
});
