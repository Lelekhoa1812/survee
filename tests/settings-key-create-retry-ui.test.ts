// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("../src/components/ui", async () => {
  const React = await import("react");
  return {
    api,
    Badge: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
    CopyButton: () => React.createElement("button", null, "Copy"),
    Icon: () => null,
    Modal: ({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) => React.createElement("section", { role: "dialog", "aria-label": title }, React.createElement("h2", null, title), children, actions),
    Spinner: () => null,
    useToast: () => vi.fn(),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../src/components/AccountSettingsPanel", () => ({ AccountSettingsPanel: () => null }));
vi.mock("../src/components/ImageAssetsPanel", () => ({ ImageAssetsPanel: () => null }));
vi.mock("../src/components/WorkspaceMembersPanel", () => ({ WorkspaceMembersPanel: () => null }));
vi.mock("../src/components/WorkspaceAnalyticsPanel", () => ({ WorkspaceAnalyticsPanel: () => null }));

import { SettingsConsole } from "../src/components/SettingsConsole";

const props = {
  initialKeys: [], loadError: false, canManageKeys: true, envToken: false, origin: null, tenantAudit: null,
  tenantAuditError: false, mayManageLegacy: false, account: null,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); });
}

async function clickUntilApi(label: string, minCalls: number) {
  await click(label);
  await vi.waitFor(() => {
    expect(api.mock.calls.length).toBeGreaterThanOrEqual(minCalls);
  });
}

async function setValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("API key create form retry", () => {
  it("sends the same client-generated secret and operation ID when retrying in the same modal", async () => {
    api.mockResolvedValueOnce({ ok: false, status: 500, data: { error: "Try again" } })
      .mockResolvedValueOnce({ ok: true, status: 201, data: { key: { id: "key-1", name: "Agent" }, secret: "returned" } })
      .mockResolvedValue({ ok: true, status: 200, data: { keys: [] } });
    await act(async () => root.render(createElement(SettingsConsole, props)));
    await click("New key");
    const name = container.querySelector('input[placeholder="Laptop agent"]') as HTMLInputElement;
    await setValue(name, "Agent");
    await clickUntilApi("Create key", 1);
    expect(api).toHaveBeenCalledTimes(1);
    const first = api.mock.calls[0][1];
    expect(first.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.body.value).toMatch(/^kqa_[A-Za-z0-9_-]{43}$/);
    await clickUntilApi("Create key", 3);
    expect(api).toHaveBeenCalledTimes(3);
    const retry = api.mock.calls[1][1];
    expect(retry.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    expect(retry.body.value).toBe(first.body.value);
    expect(storedText()).not.toContain(first.body.value);
  });

  it("uses a new operation ID when the key details change and keeps the secret", async () => {
    api.mockResolvedValue({ ok: false, status: 500, data: { error: "Try again" } });
    await act(async () => root.render(createElement(SettingsConsole, props)));
    await click("New key");
    const name = container.querySelector('input[placeholder="Laptop agent"]') as HTMLInputElement;
    await setValue(name, "Agent");
    await clickUntilApi("Create key", 1);
    const first = api.mock.calls[0][1];
    await setValue(name, "Agent renamed");
    await clickUntilApi("Create key", 2);
    const retry = api.mock.calls[1][1];
    expect(retry.headers["Idempotency-Key"]).not.toBe(first.headers["Idempotency-Key"]);
    expect(retry.body.name).toBe("Agent renamed");
    expect(retry.body.value).toBe(first.body.value);
    expect(storedText()).not.toContain(first.body.value);
  });

  it("saves an existing key without an operation ID", async () => {
    api.mockResolvedValue({ ok: true, status: 200, data: { key: { id: "key-1", name: "Agent renamed" }, keys: [] } });
    const initialKeys = [{
      id: "key-1", name: "Agent", note: "desk", prefix: "kqa_preview", suffix: "wxyz",
      createdAt: "2026-01-01T00:00:00.000Z", createdBy: "owner@example.test", lastUsedAt: null,
      expiresAt: null, revokedAt: null, status: "active" as const, capabilities: ["interviews:read" as const],
    }];
    await act(async () => root.render(createElement(SettingsConsole, { ...props, initialKeys })));
    await click("Edit");
    expect(container.textContent).toContain("Generate the key value in the form");
    expect(container.textContent).not.toContain("Key value");
    const name = container.querySelector('input[placeholder="Laptop agent"]') as HTMLInputElement;
    await setValue(name, "Agent renamed");
    await clickUntilApi("Save", 1);
    const save = api.mock.calls.find((call) => call[0] === "/api/admin/keys/key-1");
    expect(save?.[1]).toMatchObject({ method: "PATCH", body: { name: "Agent renamed", note: "desk", expiresAt: null, capabilities: ["interviews:read"] } });
    expect(save?.[1].headers?.["Idempotency-Key"]).toBeUndefined();
  });
});

function storedText(): string {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index) ?? "") ?? "").join("\n");
}
