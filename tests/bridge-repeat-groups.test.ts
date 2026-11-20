import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";
import { respondentBridgeMessages } from "../src/lib/respondent-locale";

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
  it("localizes default record labels and existing announcements when the language changes", () => {
    const dom = new JSDOM(questionnaire, { runScripts: "dangerously" });
    const { window } = dom;
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    window.eval(BRIDGE_SOURCE);
    send({ type: "init", locale: "en-AU", messages: respondentBridgeMessages("en-AU"), questions: [{ id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "name", type: "text", label: "Name" }] }], answers: {}, recordGroups: {} });
    window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!.click();
    expect(window.document.querySelector("[data-kqa-record-status=assets]")?.textContent).toContain("record 1 added");
    send({ type: "locale", locale: "es", messages: respondentBridgeMessages("es") });
    expect(window.document.querySelector("[data-kqa-record-add=assets]")?.textContent).toBe("Añadir registro");
    expect(window.document.querySelector("fieldset[data-kqa-record-question] legend")?.textContent).toBe("registro 1");
    expect(window.document.querySelector("[data-kqa-record-status=assets]")?.textContent).toBe("Se añadió registro 1.");
    send({ type: "locale", locale: "ar", messages: respondentBridgeMessages("ar") });
    expect(window.document.querySelector("[data-kqa-record-add=assets]")?.textContent).toContain("سجل");
    window.close();
  });

  it("reports invalid drafts until correction, explicit discard, or row removal", () => {
    const html = '<section><template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend><input type="number" data-kqa-repeat-field="amount"></fieldset></template></section>';
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const { window } = dom;
    const post = vi.spyOn(window, "postMessage");
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    const lastDrafts = () => post.mock.calls.map(([message]) => message as any).filter((message) => message.type === "record-drafts").at(-1).drafts;
    const snapshot = { assets: [{ id: "row1", values: { amount: 2 }, revision: 1, fieldRevisions: { amount: 1 } }] };
    window.eval(BRIDGE_SOURCE);
    send({ type: "init", questions: [{ id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "amount", type: "number", label: "Amount", min: 1 }] }], answers: {}, recordGroups: snapshot });
    expect(lastDrafts()).toEqual([]);
    const setAmount = (value: string) => {
      const input = window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!;
      input.value = value;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    setAmount("0");
    expect(lastDrafts()).toEqual([{ questionId: "assets", rowId: "row1", fieldId: "amount" }]);
    send({ type: "record-groups", recordGroups: snapshot });
    expect(window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!.value).toBe("0");
    send({ type: "locale", locale: "ar", messages: {} });
    expect(lastDrafts()).toHaveLength(1);
    send({ type: "lock", locked: true });
    expect(lastDrafts()).toHaveLength(1);
    send({ type: "lock", locked: false });
    setAmount("2");
    expect(lastDrafts()).toEqual([]);
    setAmount("0");
    send({ type: "discard-record-draft", questionId: "assets", rowId: "row1", fieldId: "amount" });
    expect(lastDrafts()).toEqual([]);
    expect(window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!.value).toBe("2");
    setAmount("0");
    window.document.querySelector<HTMLButtonElement>('button[data-kqa-record-remove="row1"]')!.click();
    expect(lastDrafts()).toEqual([]);
    const messages = post.mock.calls.map(([message]) => message as any);
    expect(messages.findLastIndex((message) => message.type === "record-operation" && message.operation.op === "remove")).toBeLessThan(messages.findLastIndex((message) => message.type === "record-drafts"));
    window.close();
  });

  it("preserves a newer invalid draft when an earlier record operation is rejected and allows discarding it after a row disappears", () => {
    const html = '<section><template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend><input type="number" data-kqa-repeat-field="amount"></fieldset></template></section>';
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const { window } = dom;
    const post = vi.spyOn(window, "postMessage");
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    const messages = () => post.mock.calls.map(([message]) => message as any);
    const snapshot = { assets: [{ id: "row1", values: { amount: 2 }, revision: 1, fieldRevisions: { amount: 1 } }] };
    window.eval(BRIDGE_SOURCE);
    send({ type: "init", questions: [{ id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "amount", type: "number", label: "Amount", min: 1 }] }], answers: {}, recordGroups: snapshot });
    const input = window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!;
    input.value = "3";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const operationId = messages().findLast((message) => message.type === "record-operation").operationId;
    input.value = "0";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    send({ type: "record-rejected", rejectedOperationIds: [operationId], recordGroups: snapshot });
    expect(window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!.value).toBe("0");
    send({ type: "record-groups", recordGroups: { assets: [] } });
    expect(messages().filter((message) => message.type === "record-drafts").at(-1).drafts).toHaveLength(1);
    send({ type: "discard-record-draft", questionId: "assets", rowId: "row1", fieldId: "amount" });
    expect(messages().filter((message) => message.type === "record-drafts").at(-1).drafts).toEqual([]);
    window.close();
  });
  it("updates answered and not-answered routes when records are added, removed, or restored", () => {
    const html = questionnaire.replace("</body>", '<section data-kqa-question-id="has-assets"><input data-kqa="has-assets"></section><section data-kqa-question-id="no-assets"><input data-kqa="no-assets"></section></body>');
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const { window } = dom;
    const post = vi.spyOn(window, "postMessage");
    window.eval(BRIDGE_SOURCE);
    const questions = [
      { id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "name", type: "text", label: "Name" }] },
      { id: "has-assets", type: "text", label: "Has assets", when: { all: [{ question: "assets", operator: "answered" }] } },
      { id: "no-assets", type: "text", label: "No assets", when: { all: [{ question: "assets", operator: "notAnswered" }] } },
    ];
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    const visible = (id: string) => !window.document.querySelector<HTMLElement>(`[data-kqa-question-id="${id}"]`)!.hidden;
    send({ type: "init", questions, answers: {}, recordGroups: {} });
    expect([visible("has-assets"), visible("no-assets")]).toEqual([false, true]);
    expect(window.KQA.isAnswered("assets")).toBe(false);
    window.document.querySelector<HTMLButtonElement>("[data-kqa-record-add=assets]")!.click();
    expect([visible("has-assets"), visible("no-assets")]).toEqual([true, false]);
    expect(window.KQA.isAnswered("assets")).toBe(true);
    expect(window.KQA.progress()).toEqual({ answered: 1, total: 2 });
    expect(post.mock.calls.map(([message]) => message as any).some((message) => message.type === "eligibility" && message.eligible["has-assets"])).toBe(true);
    const rowId = operations(post)[0].rowId!;
    window.document.querySelector<HTMLButtonElement>(`button[data-kqa-record-remove="${rowId}"]`)!.click();
    expect([visible("has-assets"), visible("no-assets")]).toEqual([false, true]);
    expect(window.KQA.isAnswered("assets")).toBe(false);
    send({ type: "record-groups", recordGroups: { assets: [{ id: "saved", values: {}, revision: 0, fieldRevisions: {} }] } });
    expect([visible("has-assets"), visible("no-assets")]).toEqual([true, false]);
    send({ type: "record-groups", recordGroups: { assets: [] } });
    expect([visible("has-assets"), visible("no-assets")]).toEqual([false, true]);
    window.close();
  });

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
