import { describe, expect, it } from "vitest";
import { patchRequiredQuestions } from "../src/lib/mcp/questionnaire-required-patch";
import { validateToolArgs } from "../src/lib/mcp/validate";

const html = `<!doctype html>
<html lang="en-AU"><head><title>Test</title>
<script type="application/json" id="kqa-manifest">
{
  "format": "kqa/1",
  "title": "Test",
  "questions": [
    { "id": "name", "type": "text", "label": "Name" },
    { "id": "choice", "type": "single", "label": "Choice", "required": true, "options": [{ "value": "a", "label": "A" }, { "value": "b", "label": "B" }] }
  ]
}
</script></head><body><main><input data-kqa="name"></main><script>window.customMarkup = true;</script></body></html>`;

describe("questionnaire requiredness patch", () => {
  it("changes only targeted manifest booleans and preserves surrounding HTML", () => {
    const result = patchRequiredQuestions(html, [
      { questionId: "name", required: true },
      { questionId: "choice", required: false },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html.startsWith(html.slice(0, html.indexOf("<script type=\"application/json\"")))).toBe(true);
    expect(result.html.slice(result.html.indexOf("</script>"))).toBe(html.slice(html.indexOf("</script>")));
    expect(result.html).toContain('{ "id": "name", "type": "text", "label": "Name", "required": true }');
    expect(result.html).toContain('"required": false');
    expect(result.changes).toEqual([
      { questionId: "name", required: true, beforeRequired: false },
      { questionId: "choice", required: false, beforeRequired: true },
    ]);
  });

  it("rejects duplicate, unknown, and no-op question changes", () => {
    expect(patchRequiredQuestions(html, [
      { questionId: "name", required: true },
      { questionId: "name", required: false },
    ])).toMatchObject({ ok: false, error: "Question name appears more than once." });
    expect(patchRequiredQuestions(html, [{ questionId: "missing", required: true }])).toMatchObject({ ok: false, error: "Question missing was not found in the current version." });
    expect(patchRequiredQuestions(html, [{ questionId: "choice", required: true }])).toMatchObject({ ok: false, error: "Question choice is already required." });
  });

  it("enforces batch size in the published tool schema", () => {
    const schema = {
      type: "object",
      properties: { changes: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } } },
      required: ["changes"],
      additionalProperties: false,
    };
    expect(validateToolArgs(schema, { changes: [] })).toContain("at least 1 item");
    expect(validateToolArgs(schema, { changes: ["a", "b", "c"] })).toContain("at most 2 items");
    expect(validateToolArgs(schema, { changes: ["a"] })).toBeNull();
  });
});
