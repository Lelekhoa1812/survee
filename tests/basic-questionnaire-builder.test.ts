import { describe, expect, it } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";
import { generateBasicQuestionnaireHtml, type BasicQuestionnaire } from "../src/lib/builder/basic-questionnaire";

describe("basic questionnaire HTML generator", () => {
  it("generates checker-clean, unselected native controls for every supported type", () => {
    const input: BasicQuestionnaire = {
      title: "New questionnaire",
      description: "Short description",
      questions: [
        { id: "single-choice", type: "single", label: "Pick one", help: "One answer", required: true, options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] },
        { id: "multi-choice", type: "multi", label: "Pick any", help: "Several answers", required: false, options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] },
        { id: "dropdown", type: "select", label: "Choose a value", help: "", required: false, options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] },
        { id: "priority-order", type: "rank", label: "Order your priorities", help: "", required: false, options: [{ value: "cost", label: "Cost" }, { value: "speed", label: "Speed" }, { value: "quality", label: "Quality" }] },
        { id: "short-answer", type: "text", label: "Short answer", help: "", required: false, options: [] },
        { id: "long-answer", type: "longtext", label: "Long answer", help: "", required: false, options: [] },
        { id: "quantity", type: "number", label: "How many?", help: "", required: false, options: [], min: 0, max: 100 },
        { id: "rating", type: "scale", label: "How much?", help: "One to five", required: false, options: [], min: 1, max: 5 },
        { id: "start-date", type: "date", label: "When?", help: "", required: false, options: [] },
      ],
    };
    const html = generateBasicQuestionnaireHtml(input);
    const report = checkHtml(html, { fileName: "generated.html" });
    expect(report.ok).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect((html.match(/data-kqa-question-id=/g) ?? [])).toHaveLength(input.questions.length);
    expect((html.match(/data-kqa="/g) ?? [])).toHaveLength(2 + 2 + 1 + 1 + 1 + 1 + 1 + 5 + 1);
    expect(html).not.toMatch(/<(?:input|option)[^>]*\s(?:checked|selected|required|disabled)(?:\s|=|>)/i);
  });

  it("escapes questionnaire content in both HTML and the manifest script", () => {
    const html = generateBasicQuestionnaireHtml({
      title: "Planning </script><img src=x onerror=alert(1)>", description: "A & B",
      questions: [{ id: "choice", type: "single", label: "Question <script>", help: "", required: false, options: [{ value: "a", label: "</script><script>" }, { value: "b", label: "Second" }] }],
    });
    expect(html).toContain("Planning &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('\\u003c/script>');
    expect(html).not.toContain("<script><img");
    expect(checkHtml(html, { fileName: "generated.html" }).ok).toBe(true);
  });

  it("groups assigned questions into checker-valid section lists and escapes section content", () => {
    const html = generateBasicQuestionnaireHtml({
      title: "Sectioned questionnaire", description: "A description", sections: [{ id: "work", title: "Work <now>", description: "Focus & progress" }],
      questions: [{ id: "focus", type: "text", label: "What is your focus?", help: "", required: false, section: "work", options: [] }],
    });
    const report = checkHtml(html, { fileName: "generated.html" });
    expect(report.ok).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(html).toContain('"sections": [');
    expect(html).toContain('"section": "work"');
    expect(html).toContain('<div data-kqa-question-list="work">');
    expect(html).toContain("Work &lt;now&gt;");
    expect(html).toContain("Focus &amp; progress");
  });

  it("generates a bounded route from an earlier choice without changing answer semantics", () => {
    const html = generateBasicQuestionnaireHtml({
      title: "Routed questionnaire", description: "", questions: [
        { id: "audience", type: "single", label: "Who is this for?", help: "", required: false, options: [{ value: "team", label: "A team" }, { value: "self", label: "Myself" }] },
        { id: "team-size", type: "number", label: "How many people?", help: "", required: false, options: [], when: { all: [{ question: "audience", operator: "equals", value: "team" }] } },
      ],
    });
    const report = checkHtml(html, { fileName: "generated.html" });
    expect(report.ok).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(html).toContain('"when": {\n        "all": [');
    expect(html).toContain('"question": "audience"');
    expect(html).toContain('"value": "team"');
  });

  it("rejects invalid identifiers, duplicate ids, and malformed choice sets", () => {
    const base = { title: "Questionnaire", description: "", questions: [{ id: "invalid ID", type: "text" as const, label: "Question", help: "", required: false, options: [] }] };
    expect(() => generateBasicQuestionnaireHtml(base)).toThrow(/questions\.0\.id/);
    expect(() => generateBasicQuestionnaireHtml({ ...base, questions: [base.questions[0], { ...base.questions[0], id: "invalid ID" }] })).toThrow();
  });
});
