import { describe, expect, it } from "vitest";
import { patchQuestionnaireBlocks } from "../src/lib/mcp/questionnaire-block-patch";

const base = `<!doctype html><html><head><script id="kqa-manifest" type="application/json">{"format":"kqa/1","title":"T","questions":[{"id":"old","type":"text","label":"Old"}]}</script></head><body><div data-kqa-question-list=""><section data-kqa-question-id="old"><label>Old</label></section></div><footer>keep me</footer></body></html>`;
const fourQuestions = base
  .replace('"questions":[{"id":"old","type":"text","label":"Old"}]', '"questions":[{"id":"old","type":"text","label":"Old"},{"id":"two","type":"text","label":"Two"},{"id":"three","type":"text","label":"Three"},{"id":"four","type":"text","label":"Four"}]')
  .replace('</div>', '<section data-kqa-question-id="two">Two</section><section data-kqa-question-id="three">Three</section><section data-kqa-question-id="four">Four</section></div>');

function questionIds(html: string): string[] {
  const match = html.match(/<script id="kqa-manifest" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Manifest not found");
  return (JSON.parse(match[1]!) as { questions: { id: string }[] }).questions.map(({ id }) => id);
}

function htmlQuestionIds(html: string): string[] {
  return [...html.matchAll(/data-kqa-question-id="([^"]+)"/g)].map((match) => match[1]!);
}

const twoSections = `<!doctype html><html><head><script id="kqa-manifest" type="application/json">{"format":"kqa/1","title":"T","sections":[{"id":"a","title":"A"},{"id":"b","title":"B"}],"questions":[{"id":"one","type":"text","label":"One","section":"a"},{"id":"two","type":"text","label":"Two","section":"b"}]}</script></head><body><div data-kqa-question-list="a"><section data-kqa-question-id="one">One</section></div><div data-kqa-question-list="b"><section data-kqa-question-id="two">Two</section></div><footer>keep me</footer></body></html>`;

describe("questionnaire block patch", () => {
  it("adds a question to the section list and manifest while preserving unrelated bytes", () => {
    const result = patchQuestionnaireBlocks(base, [{ op: "add", question: { id: "new", type: "text", label: "New" }, html: '<section data-kqa-question-id="new"><label>New</label></section>' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('{"id":"new","type":"text","label":"New"}');
      expect(result.html).toContain('<section data-kqa-question-id="new"><label>New</label></section>');
      expect(result.html).toContain("<footer>keep me</footer>");
    }
  });
  it("updates both selected representations and deletes safely", () => {
    const updated = patchQuestionnaireBlocks(base, [{ op: "update", questionId: "old", question: { id: "old", type: "text", label: "Fresh" }, html: '<section data-kqa-question-id="old">Fresh</section>' }]);
    expect(updated.ok && updated.html).toContain('"label":"Fresh"');
    expect(updated.ok && updated.html).toContain(">Fresh</section>");
    const two = base.replace('"questions":[{"id":"old","type":"text","label":"Old"}]', '"questions":[{"id":"old","type":"text","label":"Old"},{"id":"two","type":"text","label":"Two"}]').replace('</div>', '<section data-kqa-question-id="two">Two</section></div>');
    const deleted = patchQuestionnaireBlocks(two, [{ op: "delete", questionId: "old" }]);
    expect(deleted.ok && deleted.html).not.toContain('data-kqa-question-id="old"');
    expect(deleted.ok && deleted.html).not.toContain('"id":"old"');
  });
  it("rejects unsafe fragments, duplicate operation ids, and external script references", () => {
    expect(patchQuestionnaireBlocks(base, [{ op: "add", question: { id: "new", type: "text", label: "New" }, html: '<section data-kqa-question-id="new" onclick="x()">x</section>' }]).ok).toBe(false);
    expect(patchQuestionnaireBlocks(base, [
      { op: "delete", questionId: "old" }, { op: "delete", questionId: "old" },
    ]).ok).toBe(false);
    const two = base.replace('"questions":[{"id":"old","type":"text","label":"Old"}]', '"questions":[{"id":"old","type":"text","label":"Old"},{"id":"two","type":"text","label":"Two"}]').replace('</div>', '<section data-kqa-question-id="two">Two</section></div>');
    const referenced = two.replace("</body>", '<script>use("old")</script></body>');
    expect(patchQuestionnaireBlocks(referenced, [{ op: "delete", questionId: "old" }])).toMatchObject({ ok: false, error: expect.stringContaining("inline script") });
  });

  it("keeps batched additions in operation order and preserves unrelated source", () => {
    const result = patchQuestionnaireBlocks(base, [
      { op: "add", question: { id: "new-a", type: "text", label: "New A" }, html: '<section data-kqa-question-id="new-a">A</section>' },
      { op: "add", question: { id: "new-b", type: "text", label: "New B" }, html: '<section data-kqa-question-id="new-b">B</section>' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(questionIds(result.html)).toEqual(["old", "new-a", "new-b"]);
      expect(result.html.indexOf('data-kqa-question-id="new-a"')).toBeLessThan(result.html.indexOf('data-kqa-question-id="new-b"'));
      expect(result.html).toContain("<footer>keep me</footer>");
    }
  });

  it("deletes adjacent questions as a valid batch and can replace a one-question questionnaire", () => {
    const deleted = patchQuestionnaireBlocks(fourQuestions, [
      { op: "delete", questionId: "two" },
      { op: "delete", questionId: "three" },
    ]);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(questionIds(deleted.html)).toEqual(["old", "four"]);

    const replaced = patchQuestionnaireBlocks(base, [
      { op: "delete", questionId: "old" },
      { op: "add", question: { id: "replacement", type: "text", label: "Replacement" }, html: '<section data-kqa-question-id="replacement">Replacement</section>' },
    ]);
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(questionIds(replaced.html)).toEqual(["replacement"]);
      expect(replaced.html).not.toContain('data-kqa-question-id="old"');
    }
  });

  it("rejects an update that changes the stable question ID", () => {
    const result = patchQuestionnaireBlocks(base, [{
      op: "update", questionId: "old", question: { id: "new", type: "text", label: "Fresh" }, html: '<section data-kqa-question-id="old">Fresh</section>',
    }]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("cannot change its id") });
  });

  it("reorders a question within its section in both the manifest and HTML", () => {
    const result = patchQuestionnaireBlocks(fourQuestions, [{ op: "move", questionId: "four", beforeQuestionId: "two" }]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(questionIds(result.html)).toEqual(["old", "four", "two", "three"]);
      expect(htmlQuestionIds(result.html)).toEqual(["old", "four", "two", "three"]);
      expect(result.changes).toEqual([{ op: "move", questionId: "four", section: undefined }]);
      expect(result.html).toContain("<footer>keep me</footer>");
    }
  });

  it("moves a question across sections and supports insertion before or after an existing question", () => {
    const moved = patchQuestionnaireBlocks(twoSections, [{ op: "move", questionId: "two", section: "a", beforeQuestionId: "one" }]);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(questionIds(moved.html)).toEqual(["two", "one"]);
      expect(JSON.parse(moved.html.match(/<script id="kqa-manifest" type="application\/json">([\s\S]*?)<\/script>/)![1]!).questions[0]).toMatchObject({ id: "two", section: "a" });
      expect(htmlQuestionIds(moved.html)).toEqual(["two", "one"]);
      expect(moved.html).toContain('<div data-kqa-question-list="b"></div>');
    }

    const appended = patchQuestionnaireBlocks(twoSections, [{ op: "move", questionId: "two", section: "a" }]);
    expect(appended.ok).toBe(true);
    if (appended.ok) {
      expect(questionIds(appended.html)).toEqual(["one", "two"]);
      expect(htmlQuestionIds(appended.html)).toEqual(["one", "two"]);
    }

    const added = patchQuestionnaireBlocks(fourQuestions, [{
      op: "add",
      question: { id: "five", type: "text", label: "Five" },
      html: '<section data-kqa-question-id="five">Five</section>',
      afterQuestionId: "two",
    }]);
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(questionIds(added.html)).toEqual(["old", "two", "five", "three", "four"]);
      expect(htmlQuestionIds(added.html)).toEqual(["old", "two", "five", "three", "four"]);
    }
  });

  it("rejects missing, cross-section, or changed insertion targets", () => {
    expect(patchQuestionnaireBlocks(base, [{
      op: "add", question: { id: "new", type: "text", label: "New" }, html: '<section data-kqa-question-id="new">New</section>', beforeQuestionId: "missing",
    }])).toMatchObject({ ok: false, error: expect.stringContaining("was not found") });
    expect(patchQuestionnaireBlocks(twoSections, [{ op: "move", questionId: "two", beforeQuestionId: "one" }])).toMatchObject({
      ok: false, error: expect.stringContaining("must be in section b"),
    });
    expect(patchQuestionnaireBlocks(fourQuestions, [
      { op: "add", question: { id: "five", type: "text", label: "Five" }, html: '<section data-kqa-question-id="five">Five</section>', beforeQuestionId: "two" },
      { op: "update", questionId: "two", question: { id: "two", type: "text", label: "Two updated" }, html: '<section data-kqa-question-id="two">Two updated</section>' },
    ])).toMatchObject({ ok: false, error: expect.stringContaining("also appears in this operation batch") });
  });
});
