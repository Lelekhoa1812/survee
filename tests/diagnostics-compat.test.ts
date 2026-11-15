import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/lib/format/schema";
import { compareVersions } from "../src/lib/diagnostics/compat";

const manifest = (questions: Manifest["questions"]): Manifest => ({ format: "kqa/1", title: "Survey", questions });

describe("compareVersions", () => {
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
});
