import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";
import { respondentBridgeMessages } from "../src/lib/respondent-locale";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; close: () => void };
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
});
