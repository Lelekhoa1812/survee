// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../src/components/LoginForm";

const state = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../src/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/ui")>()),
  api: state.api,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset();
  state.api.mockResolvedValue({ ok: false, status: 401, data: { error: "That email and password do not match." } });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function fill(id: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

describe("login form errors", () => {
  it("announces credential failures at form level without blaming either field", async () => {
    await act(async () => root.render(createElement(LoginForm, { next: "/admin" })));
    await fill("email", "person@example.com");
    await fill("password", "wrong password");
    await submit();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That email and password do not match.");
    expect(host.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(host.querySelectorAll(".field .field-error")).toHaveLength(0);

    await fill("email", "person+corrected@example.com");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
