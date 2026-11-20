import { describe, expect, it } from "vitest";
import { validateAnswer } from "../src/lib/format/answers";
import type { Question } from "../src/lib/format/schema";
import { respondentMessage, respondentRepeatIssue, type RespondentLocale } from "../src/lib/respondent-locale";

const number: Question = { id: "team-size", label: "Team size", type: "number", required: false, min: 1, max: 500 };
const text: Question = { id: "goal", label: "Goal", type: "text", required: false, maxLength: 5 };
const checkbox: Question = { id: "channels", label: "Channels", type: "multi", required: false, options: [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "post", label: "Post" }], maxSelections: 2 };

describe("respondent answer refusals", () => {
  it("gives each refused scalar answer a stable code and the bound it broke", () => {
    expect(validateAnswer(number, 999999)).toMatchObject({ ok: false, code: "above_maximum", params: { maximum: 500 } });
    expect(validateAnswer(number, 0)).toMatchObject({ ok: false, code: "below_minimum", params: { minimum: 1 } });
    expect(validateAnswer(number, "lots")).toMatchObject({ ok: false, code: "expected_number" });
    expect(validateAnswer(text, "far too long")).toMatchObject({ ok: false, code: "max_length", params: { maximum: 5 } });
  });

  it("gives choice refusals codes and the selection limit", () => {
    expect(validateAnswer(checkbox, ["email", "phone", "post"])).toMatchObject({ ok: false, code: "above_maximum_selections", params: { maximum: 2 } });
    expect(validateAnswer(checkbox, ["fax"])).toMatchObject({ ok: false, code: "invalid_option" });
  });

  it("translates a refused number into a sentence that names the limit in every locale", () => {
    expect(respondentRepeatIssue("en-AU", { code: "above_maximum", params: { maximum: 500 } })).toBe("Enter a number no greater than 500.");
    for (const locale of ["vi", "es", "ar"] as RespondentLocale[]) {
      expect(respondentRepeatIssue(locale, { code: "above_maximum", params: { maximum: 500 } })).toContain("500");
    }
  });

  it("names the question in the refusal message without the connection advice", () => {
    expect(respondentMessage("en-AU", "answerRefused", { question: "Team size", reason: "Enter a number no greater than 500." })).toBe("Could not save “Team size”. Enter a number no greater than 500.");
  });
});
