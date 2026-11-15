// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "../src/components/SignupForm";

const state = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/components/ui", () => ({
  api: state.api,
  BrandMark: () => createElement("span", null, "KQA"),
  Spinner: () => createElement("span", null, "Loading"),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset();
  state.api.mockResolvedValue({ ok: false, status: 503, data: { error: "Signup is temporarily unavailable." } });
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

describe("signup form errors", () => {
  it("associates a server field error with the right input and focuses it", async () => {
    state.api.mockResolvedValueOnce({ ok: false, status: 400, data: { error: "Use an email address that can receive the verification message.", field: "email" } });
    await act(async () => root.render(createElement(SignupForm)));
    await fill("tenantName", "Research team");
    await fill("signupEmail", "person@example.com");
    await fill("signupPassword", "long enough password");
    await submit();

    const email = host.querySelector<HTMLInputElement>("#signupEmail")!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("signupEmail-error");
    expect(host.querySelector("#signupEmail-error")?.textContent).toContain("verification message");
    expect(email.closest(".field")?.querySelector(".field-error")).toBe(host.querySelector("#signupEmail-error"));
    expect(host.querySelector<HTMLInputElement>("#signupPassword")?.getAttribute("aria-invalid")).toBe("false");
    expect(document.activeElement).toBe(email);
  });

  it("announces service errors at form level without marking fields invalid", async () => {
    await act(async () => root.render(createElement(SignupForm)));
    await fill("tenantName", "Research team");
    await fill("signupEmail", "person@example.com");
    await fill("signupPassword", "long enough password");
    await submit();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Signup is temporarily unavailable.");
    expect(host.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(host.querySelectorAll(".field .field-error")).toHaveLength(0);
  });

  it("clears a field error as the user corrects that field", async () => {
    state.api.mockResolvedValueOnce({ ok: false, status: 400, data: { error: "Enter a valid email address.", field: "email" } });
    await act(async () => root.render(createElement(SignupForm)));
    await fill("tenantName", "Research team");
    await fill("signupEmail", "invalid");
    await fill("signupPassword", "long enough password");
    await submit();
    expect(host.querySelector<HTMLInputElement>("#signupEmail")?.getAttribute("aria-invalid")).toBe("true");

    await fill("signupEmail", "person@example.com");
    expect(host.querySelector<HTMLInputElement>("#signupEmail")?.getAttribute("aria-invalid")).toBe("false");
    expect(host.querySelector("#signupEmail-error")).toBeNull();
  });
});
