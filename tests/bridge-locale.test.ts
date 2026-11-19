import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";
import { respondentBridgeMessages } from "../src/lib/respondent-locale";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; Event: typeof Event; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => { window: BridgeWindow; close: () => void };
};

describe("respondent locale bridge", () => {
  it("localizes KQA-generated rank controls without changing questionnaire language metadata", () => {
    const dom = new JSDOM(`<!doctype html><html lang="fr-CA" dir="ltr"><body><ol data-kqa="priority"><li data-value="a">Alpha</li><li data-value="b">Bêta</li></ol></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    const send = (data: Record<string, unknown>) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    send({ type: "init", locale: "ar", messages: respondentBridgeMessages("ar"), questions: [{ id: "priority", type: "rank", label: "Priorité", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Bêta" }] }], answers: {} });
    const confirm = window.document.querySelector<HTMLButtonElement>('[data-kqa-rank-confirm="priority"]')!;
    expect(confirm.textContent).toBe("استخدام هذا الترتيب");
    const moveUp = window.document.querySelector<HTMLButtonElement>('button[data-kqa-rank-move="up"]')!;
    expect(moveUp.textContent).toBe("تحريك لأعلى");
    expect(moveUp.getAttribute("lang")).toBe("ar");
    expect(moveUp.getAttribute("dir")).toBe("rtl");
    send({ type: "locale", locale: "vi", messages: respondentBridgeMessages("vi") });
    expect(confirm.textContent).toBe("Dùng thứ tự này");
    expect(confirm.getAttribute("lang")).toBe("vi");
    expect(confirm.getAttribute("dir")).toBe("ltr");
    expect(window.document.documentElement.lang).toBe("fr-CA");
    expect(window.document.documentElement.dir).toBe("ltr");
    window.close();
  });

  it("relocalizes repeat validation and conflict messages without resetting the draft or focus", () => {
    const dom = new JSDOM(`<!doctype html><html><body><section><template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend><input type="number" data-kqa-repeat-field="amount"></fieldset></template></section></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    const send = (data: Record<string, unknown>) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    send({ type: "init", locale: "en-AU", messages: respondentBridgeMessages("en-AU"), questions: [{ id: "assets", type: "repeat", label: "Assets", itemLabel: "asset", maxRows: 2, fields: [{ id: "amount", type: "number", label: "Amount", min: 1 }] }], answers: {}, recordGroups: { assets: [{ id: "row1", values: { amount: 2 }, revision: 1, fieldRevisions: { amount: 1 } }] } });
    const input = window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!;
    input.focus();
    input.value = "0";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const error = window.document.querySelector<HTMLElement>('[data-kqa-repeat-error="amount"]')!;
    const status = window.document.querySelector<HTMLElement>('[data-kqa-record-status="assets"]')!;
    expect(error.textContent).toBe(respondentBridgeMessages("en-AU").repeatFieldInvalid);
    send({ type: "locale", locale: "ar", messages: respondentBridgeMessages("ar") });
    expect(error.textContent).toBe(respondentBridgeMessages("ar").repeatFieldInvalid);
    expect(status.textContent).toBe(respondentBridgeMessages("ar").repeatFieldInvalid);
    expect(error.getAttribute("dir")).toBe("rtl");
    expect(status.getAttribute("lang")).toBe("ar");
    expect(input.value).toBe("0");
    expect(window.document.activeElement).toBe(input);
    window.close();
  });


  it("relocalizes a retained repeat conflict and its status after a server snapshot", () => {
    const dom = new JSDOM(`<!doctype html><html><body><section><template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend><input data-kqa-repeat-field="name"></fieldset></template></section></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    const send = (data: Record<string, unknown>) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    send({ type: "init", locale: "en-AU", messages: respondentBridgeMessages("en-AU"), questions: [{ id: "assets", type: "repeat", label: "Assets", itemLabel: "asset", maxRows: 2, fields: [{ id: "name", type: "text", label: "Name" }] }], answers: {}, recordGroups: { assets: [{ id: "row1", values: { name: "Saved" }, revision: 1, fieldRevisions: { name: 1 } }] } });
    const input = window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="name"]')!;
    input.value = "Draft";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    send({ type: "record-groups", recordGroups: { assets: [{ id: "row1", values: { name: "Updated elsewhere" }, revision: 2, fieldRevisions: { name: 2 } }] } });
    const error = window.document.querySelector<HTMLElement>('[data-kqa-repeat-error="name"]')!;
    const status = window.document.querySelector<HTMLElement>('[data-kqa-record-status="assets"]')!;
    const viConflict = respondentBridgeMessages("vi").repeatConflict.replace("{item}", "asset");
    send({ type: "locale", locale: "vi", messages: respondentBridgeMessages("vi") });
    expect(error.textContent).toBe(viConflict);
    expect(status.textContent).toBe(viConflict);
    expect(window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="name"]')!.value).toBe("Draft");
    window.close();
  });

});
