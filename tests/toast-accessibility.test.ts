// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../src/components/ui";

let host: HTMLDivElement;
let root: Root;

function ToastControls() {
  const toast = useToast();
  return createElement("div", null,
    createElement("button", { onClick: () => toast("Saved changes", "ok") }, "Success"),
    createElement("button", { onClick: () => toast("Could not save changes", "err") }, "Failure"),
  );
}

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); });
}

describe("toast accessibility", () => {
  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    vi.useRealTimers();
  });

  it("announces success politely and errors assertively with enough time to perceive them", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(ToastProvider, null, createElement(ToastControls))));

    await click("Success");
    expect(host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain("Saved changes");
    await click("Failure");
    const alert = host.querySelector('[role="alert"][aria-live="assertive"][aria-atomic="true"]');
    expect(alert?.textContent).toContain("Could not save changes");

    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not save changes");
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
