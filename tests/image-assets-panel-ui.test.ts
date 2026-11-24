// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));

vi.mock("../src/components/ui", () => ({
  api: state.api,
  CopyButton: () => null,
  Icon: () => null,
  Modal: () => null,
  Spinner: () => null,
  useToast: () => state.toast,
}));

import { ImageAssetsPanel } from "../src/components/ImageAssetsPanel";

let host: HTMLDivElement;
let root: Root;

function uploadResponse(name: string) {
  return {
    ok: true,
    json: async () => ({ asset: { id: name, name, fileName: name, mimeType: "image/png", bytes: 8, sha256: "a".repeat(64), url: `/api/assets/${"z".repeat(43)}`, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z" } }),
  };
}

async function selectFiles(files: File[]) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickSave(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); });
  for (let attempt = 0; attempt < 150 && host.textContent?.includes("Saving "); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset().mockImplementation(async (url: string) => url.includes("/usage")
    ? { ok: true, data: { usage: { assetCount: 4, totalBytes: 2048, quotaBytes: 100 * 1024 * 1024 } } }
    : { ok: true, data: { assets: [], nextCursor: null } });
  state.toast.mockReset();
  state.api.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
    if (url.includes("/usage")) return { ok: true, data: { usage: { assetCount: 4, totalBytes: 2048, quotaBytes: 100 * 1024 * 1024 } } };
    if (init?.method === "POST") {
      const file = (init.body as FormData).get("file") as File;
      const result = await uploadResponse(file.name).json();
      return { ok: true, status: 201, data: result };
    }
    return { ok: true, data: { assets: [], nextCursor: null } };
  });
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("workspace image library uploader", () => {
  it("shows workspace-wide image storage usage", async () => {
    await act(async () => root.render(createElement(ImageAssetsPanel)));

    expect(host.textContent).toContain("4 images · 2.0 KB of 100.00 MB stored");
    expect(state.api).toHaveBeenCalledWith("/api/admin/assets/usage");
  });

  it("accepts multiple files and saves each image in a separate request", async () => {
    await act(async () => root.render(createElement(ImageAssetsPanel)));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);

    await selectFiles([
      new File([new Uint8Array([1, 2, 3])], "one.png", { type: "image/png" }),
      new File([new Uint8Array([4, 5, 6])], "two.webp", { type: "image/webp" }),
    ]);
    expect(host.textContent).toContain("2 images. They will save one at a time");
    await clickSave("Save 2 images");

    const requests = state.api.mock.calls.filter(([url, init]) => url === "/api/admin/assets" && init?.method === "POST");
    expect(requests).toHaveLength(2);
    expect((requests[0][1]?.body as FormData).get("file")).toMatchObject({ name: "one.png" });
    expect((requests[1][1]?.body as FormData).get("file")).toMatchObject({ name: "two.webp" });
    expect(requests[0][1]?.headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
    expect(state.toast).toHaveBeenCalledWith("2 images saved to the workspace library.");
  });

  it("keeps failed files selected for retry while saving the rest of a batch", async () => {
    let failOnce = true;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const file = (init?.body as FormData).get("file") as File;
      if (file.name === "retry.png" && failOnce) {
        failOnce = false;
        return { ok: false, json: async () => ({ error: "Temporary upload failure." }) };
      }
      return uploadResponse(file.name);
    });
    state.api.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url.includes("/usage")) return { ok: true, data: { usage: { assetCount: 4, totalBytes: 2048, quotaBytes: 100 * 1024 * 1024 } } };
      if (init?.method === "POST") {
        const file = (init.body as FormData).get("file") as File;
        if (file.name === "retry.png" && failOnce) {
          failOnce = false;
          return { ok: false, status: 503, data: { error: "Temporary upload failure." } };
        }
        return { ok: true, status: 201, data: await uploadResponse(file.name).json() };
      }
      return { ok: true, data: { assets: [], nextCursor: null } };
    });
    await act(async () => root.render(createElement(ImageAssetsPanel)));
    await selectFiles([
      new File([new Uint8Array([1])], "saved.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "retry.png", { type: "image/png" }),
    ]);
    await clickSave("Save 2 images");

    expect(host.textContent).toContain("Selected retry.png");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("Save image"))).toBe(true);
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining("Failed files remain selected for retry."), "err");
    await clickSave("Save image");

    const requests = state.api.mock.calls.filter(([url, init]) => url === "/api/admin/assets" && init?.method === "POST");
    expect(requests).toHaveLength(3);
    expect((requests[2][1]?.body as FormData).get("file")).toMatchObject({ name: "retry.png" });
    expect(requests[1][1]?.headers).toEqual(requests[2][1]?.headers);
  });
});
