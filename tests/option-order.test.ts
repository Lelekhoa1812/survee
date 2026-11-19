import { describe, expect, it } from "vitest";
import { orderOptions } from "../src/lib/format/option-order";

const options = Array.from({ length: 12 }, (_, index) => ({
  value: `choice-${index + 1}`,
  label: `Choice ${index + 1}`,
}));

const base = {
  options,
  randomizeOptions: true,
  participantId: "participant-123",
  questionnaireVersion: "version-4",
  questionId: "preferred-channel",
};

const values = (result: typeof options) => result.map((option) => option.value);

describe("orderOptions", () => {
  it("returns the same order for the same participant, immutable version, and question", () => {
    expect(values(orderOptions(base))).toEqual(values(orderOptions(base)));
  });

  it.each([
    ["participantId", { participantId: "participant-456" }],
    ["questionnaireVersion", { questionnaireVersion: "version-5" }],
    ["questionId", { questionId: "other-question" }],
  ])("changes the seeded order when %s changes", (_field, change) => {
    expect(values(orderOptions(base))).not.toEqual(values(orderOptions({ ...base, ...change })));
  });

  it("keeps fixed options in their authored positions and shuffles only remaining slots", () => {
    const authored = [options[0], options[1], options[2], options[3], options[4], options[5]];
    const result = orderOptions({ ...base, options: authored, fixedOptionValues: ["choice-2", "choice-5"] });
    expect(result[1]).toBe(authored[1]);
    expect(result[4]).toBe(authored[4]);
    expect(result.filter((option) => !["choice-2", "choice-5"].includes(option.value))).toHaveLength(4);
    expect(new Set(values(result))).toEqual(new Set(values(authored)));
  });

  it("does not mutate the authored options or option objects", () => {
    const authored = options.map((option) => ({ ...option }));
    const before = authored.map((option) => ({ ...option }));
    const result = orderOptions({ ...base, options: authored });
    expect(authored).toEqual(before);
    expect(authored).toEqual(options);
    expect(result).not.toBe(authored);
  });

  it("preserves authored order when randomization is off", () => {
    const result = orderOptions({ ...base, randomizeOptions: false });
    expect(values(result)).toEqual(values(options));
    expect(result).not.toBe(options);
  });

  it("returns only the supplied option data, without adding identity or seed metadata", () => {
    const result = orderOptions(base);
    expect(result.every((option) => Object.keys(option).sort().join(",") === "label,value")).toBe(true);
  });
});
