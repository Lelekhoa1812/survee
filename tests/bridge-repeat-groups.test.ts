import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; Event: typeof Event; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously"; pretendToBeVisual?: boolean }) => { window: BridgeWindow; close: () => void };
};

const questionnaire = `<!doctype html><html><body><section data-kqa-question-id="assets">
  <template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend>
    <label>Asset name <input type="text" data-kqa-repeat-field="name"></label>
    <label>Condition <select data-kqa-repeat-field="condition"><option value="">Choose</option><option value="good">Good</option><option value="poor">Poor</option></select></label>
  </fieldset></template>
</section></body></html>`;

function start() {
  const dom = new JSDOM(questionnaire, { runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const post = vi.spyOn(window, "postMessage");
  window.eval(BRIDGE_SOURCE);
  window.dispatchEvent(new window.MessageEvent("message", { data: {
    kqa: 1, type: "init", questions: [{ id: "assets", type: "repeat", label: "List assets", itemLabel: "asset", required: true, maxRows: 2, fields: [
      { id: "name", type: "text", label: "Asset name", required: true },
      { id: "condition", type: "select", label: "Condition", options: [{ value: "good", label: "Good" }, { value: "poor", label: "Poor" }] },
    ] }], answers: {}, recordGroups: {},
  }, source: window }));
  return { dom, window, post };
}

type RecordOperation = { op: string; questionId?: string; rowId?: string; fieldId?: string; expectedFieldRevision?: number; expectedRowRevision?: number; value?: unknown };
function operations(post: { mock: { calls: unknown[][] } }): RecordOperation[] {
  return post.mock.calls.map((call: unknown[]) => call[0] as { type?: string; operation?: RecordOperation } | undefined)
    .filter((message): message is { type: string; operation: RecordOperation } => message?.type === "record-operation" && !!message.operation)
    .map((message) => message.operation as RecordOperation);
}

describe("repeat group iframe bridge", () => {
  it("adds a stable row, captures typed edits, and sends revision-fenced operations", () => {
    const page = start();
    page.window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!.click();
    const add = operations(page.post)[0];
    expect(add).toMatchObject({ op: "add", questionId: "assets" });
    expect(add.rowId).toMatch(/^r[0-9a-f]{32}$/);

    const name = page.window.document.querySelector<HTMLInputElement>(`[data-kqa-repeat-row="${add.rowId}"][data-kqa-repeat-field="name"]`)!;
    name.value = "Pump 14";
    name.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(operations(page.post)[1]).toEqual({ op: "set", questionId: "assets", rowId: add.rowId, fieldId: "name", expectedFieldRevision: 0, value: "Pump 14" });

    const condition = page.window.document.querySelector<HTMLSelectElement>(`[data-kqa-repeat-row="${add.rowId}"][data-kqa-repeat-field="condition"]`)!;
    condition.value = "good";
    condition.dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(operations(page.post)[2]).toEqual({ op: "set", questionId: "assets", rowId: add.rowId, fieldId: "condition", expectedFieldRevision: 0, value: "good" });

    name.value = "";
    name.dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(operations(page.post)[3]).toEqual({ op: "clear", questionId: "assets", rowId: add.rowId, fieldId: "name", expectedFieldRevision: 1 });
    page.window.close();
  });

  it("enforces the row cap, disables generated controls when locked, and removes with row revision", () => {
    const page = start();
    const add = page.window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!;
    add.click();
    const firstId = operations(page.post)[0].rowId;
    add.click();
    const secondId = operations(page.post)[1].rowId;
    expect(add.disabled).toBe(true);
    const secondRow = page.window.document.querySelector<HTMLElement>(`[data-kqa-record-row="${secondId}"]`)!;
    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { kqa: 1, type: "record-groups", recordGroups: { assets: [
      { id: firstId, values: {}, revision: 0, fieldRevisions: {} },
      { id: secondId, values: {}, revision: 3, fieldRevisions: {} },
    ] } }, source: page.window }));
    page.window.document.querySelector<HTMLButtonElement>(`button[data-kqa-record-remove="${secondId}"]`)!.click();
    expect(operations(page.post)[2]).toEqual({ op: "remove", questionId: "assets", rowId: secondId, expectedRowRevision: 3 });
    expect(page.window.document.querySelector<HTMLButtonElement>(`button[data-kqa-record-remove="${firstId}"]`)!.disabled).toBe(true);

    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { kqa: 1, type: "lock", locked: true }, source: page.window }));
    expect(add.disabled).toBe(true);
    expect(secondRow.isConnected).toBe(false);
    page.window.close();
  });

  it("restores host snapshots and drops a locally edited row after an authoritative rollback", () => {
    const page = start();
    page.window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!.click();
    const id = operations(page.post)[0].rowId;
    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { kqa: 1, type: "record-groups", recordGroups: { assets: [
      { id, values: { name: "Saved asset", condition: "poor" }, revision: 2, fieldRevisions: { name: 1, condition: 1 } },
    ] } }, source: page.window }));
    expect(page.window.document.querySelector<HTMLInputElement>(`[data-kqa-repeat-row="${id}"][data-kqa-repeat-field="name"]`)!.value).toBe("Saved asset");
    expect(page.window.document.querySelector<HTMLSelectElement>(`[data-kqa-repeat-row="${id}"][data-kqa-repeat-field="condition"]`)!.value).toBe("poor");
    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { kqa: 1, type: "record-groups", recordGroups: { assets: [] } }, source: page.window }));
    expect(page.window.document.querySelector(`[data-kqa-record-row="${id}"]`)).toBeNull();
    page.window.close();
  });

  it("keeps a just-typed field through a stale group snapshot while its operation is pending", () => {
    const page = start();
    page.window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!.click();
    const id = operations(page.post)[0].rowId!;
    const name = page.window.document.querySelector<HTMLInputElement>(`[data-kqa-repeat-row="${id}"][data-kqa-repeat-field="name"]`)!;
    name.value = "Unsaved edit";
    name.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { kqa: 1, type: "record-groups", recordGroups: {} }, source: page.window }));
    expect(page.window.document.querySelector<HTMLInputElement>(`[data-kqa-repeat-row="${id}"][data-kqa-repeat-field="name"]`)!.value).toBe("Unsaved edit");
    page.window.close();
  });

  it("restores focus and caret after a successful snapshot repaint", () => {
    const page = start();
    page.window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!.click();
    const id = operations(page.post)[0].rowId!;
    const input = page.window.document.querySelector<HTMLInputElement>(`[data-kqa-repeat-row="${id}"][data-kqa-repeat-field="name"]`)!;
    input.value = "Pump";
    input.focus();
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    page.window.dispatchEvent(new page.window.MessageEvent("message", { data: { kqa: 1, type: "record-groups", recordGroups: { assets: [
      { id, values: { name: "Pump" }, revision: 1, fieldRevisions: { name: 1 } },
    ] } }, source: page.window }));
    const restored = page.window.document.querySelector<HTMLInputElement>(`[data-kqa-repeat-row="${id}"][data-kqa-repeat-field="name"]`)!;
    expect(page.window.document.activeElement).toBe(restored);
    expect(restored.selectionStart).toBe(2);
    expect(restored.value).toBe("Pump");
    page.window.close();
  });
});
