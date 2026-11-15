// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../src/components/ui";

let host: HTMLDivElement;
let root: Root;
let returnFocus: HTMLButtonElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  returnFocus = document.createElement("button");
  returnFocus.textContent = "Open dialog";
  document.body.append(returnFocus);
  returnFocus.focus();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  returnFocus.remove();
});

function renderModal(onClose: () => void) {
  act(() => {
    root.render(createElement(Modal, { title: "Example dialog", onClose, children: [
      createElement("button", { key: "first" }, "First action"),
      createElement("button", { key: "last" }, "Last action"),
    ] }));
  });
}

describe("shared modal accessibility", () => {
  it("moves focus into the dialog, traps Tab in both directions, and restores focus", () => {
    renderModal(vi.fn());
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    const buttons = dialog.querySelectorAll("button");
    expect(dialog.getAttribute("aria-labelledby")).toBe(dialog.querySelector("h2")?.id);
    expect(document.activeElement).toBe(buttons[0]);
    expect(returnFocus.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    buttons[0].focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[1]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[0]);

    returnFocus.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[0]);

    act(() => root.unmount());
    expect(document.activeElement).toBe(returnFocus);
    expect(returnFocus.inert).toBe(false);
    expect(document.body.style.overflow).toBe("");
    root = createRoot(host);
  });

  it("uses the latest close callback without refocusing on callback changes", () => {
    const oldClose = vi.fn();
    const latestClose = vi.fn();
    renderModal(oldClose);
    const first = host.querySelector("button")!;
    first.focus();
    renderModal(latestClose);
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(oldClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it("does not dismiss when the backdrop is clicked", () => {
    const onClose = vi.fn();
    renderModal(onClose);
    const scrim = host.querySelector<HTMLElement>(".scrim")!;
    scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("skips focusable controls hidden by an ancestor", () => {
    act(() => root.render(createElement(Modal, {
      title: "Hidden-control test",
      onClose: vi.fn(),
      children: [
        createElement("div", { key: "hidden", style: { display: "none" } }, createElement("button", null, "Hidden")),
        createElement("button", { key: "visible" }, "Visible"),
      ],
    })));
    expect(document.activeElement?.textContent).toBe("Visible");
  });
});
