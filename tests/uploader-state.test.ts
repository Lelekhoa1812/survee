// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn(), probe: vi.fn() }));
vi.mock("../src/components/ui", () => ({ api: mocks.api, Icon: () => null }));
vi.mock("../src/components/CheckerPanel", () => ({ CheckerPanel: () => null }));
vi.mock("../src/lib/probeClient", () => ({ runProbe: mocks.probe }));
import { Uploader, type UploadState } from "../src/components/Uploader";

let host: HTMLDivElement;
let root: Root;
const changes: UploadState[] = [];

async function choose(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); changes.length = 0;
  mocks.api.mockReset().mockResolvedValue({ ok: true, data: { report: { ok: true, manifest: { questions: [] } }, markdown: "" } });
  mocks.probe.mockReset().mockResolvedValue([]);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Uploader replacement state", () => {
  it("clears the prior accepted questionnaire when a replacement is rejected", async () => {
    await act(async () => root.render(createElement(Uploader, { onChange: (state) => changes.push(state) })));
    const valid = new File(["<html></html>"], "valid.html", { type: "text/html" });
    Object.defineProperty(valid, "text", { value: async () => "<html></html>" });
    await choose(valid);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(changes.at(-1)).toMatchObject({ fileName: "valid.html", settled: true, ok: true });

    await choose(new File(["not html"], "invalid.txt", { type: "text/plain" }));

    expect(changes.at(-1)).toEqual({ settled: false, ok: false });
    expect(host.textContent).toContain("That is not an HTML file");
  });

  it("checks a builder-generated file through the same static and live pipeline", async () => {
    const file = new File(["<html></html>"], "built.html", { type: "text/html" });
    Object.defineProperty(file, "text", { value: async () => "<html></html>" });
    await act(async () => root.render(createElement(Uploader, { generatedFile: file, onChange: (state) => changes.push(state) })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.api).toHaveBeenCalledWith("/api/admin/check", { method: "POST", body: { html: "<html></html>", fileName: "built.html", interviewId: undefined } });
    expect(mocks.probe).toHaveBeenCalledWith("<html></html>", []);
    expect(changes.at(-1)).toMatchObject({ fileName: "built.html", settled: true, ok: true });
  });
});
