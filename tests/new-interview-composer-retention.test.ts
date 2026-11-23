// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  files: [] as File[],
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/ui", () => ({
  api: mocks.api,
  Icon: () => null,
  Spinner: () => null,
  useToast: () => mocks.toast,
}));
vi.mock("../src/components/Uploader", () => ({
  Uploader: ({ generatedFile }: { generatedFile?: File }) => {
    if (generatedFile && mocks.files.at(-1) !== generatedFile) mocks.files.push(generatedFile);
    return generatedFile ? createElement("p", { role: "status" }, `Checker feedback for ${generatedFile.name}`) : createElement("p", null, "No file checked");
  },
}));

import { NewInterview } from "../src/components/NewInterview";

let host: HTMLDivElement;
let root: Root;

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => button.click());
}

async function change(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!input) throw new Error(`Input not found: ${selector}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.files.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("new interview composer draft retention", () => {
  it("preserves the authored model when the builder is hidden and reopened", async () => {
    await act(async () => root.render(createElement(NewInterview)));
    await click("Build from scratch");
    await change("#builder-title", "A careful study");
    await change("#builder-label-0", "Original prompt");

    await click("Hide builder");
    const builder = host.querySelector("#basic-builder-title")?.closest(".card-pad");
    expect(builder?.hasAttribute("hidden")).toBe(true);

    await click("Build from scratch");
    expect((host.querySelector("#builder-title") as HTMLInputElement).value).toBe("A careful study");
    expect((host.querySelector("#builder-label-0") as HTMLInputElement).value).toBe("Original prompt");
  });

  it("keeps the model available after Use so checker feedback can be fixed and reapplied", async () => {
    await act(async () => root.render(createElement(NewInterview)));
    await change("#name", "Retention study");
    await click("Build from scratch");
    await change("#builder-title", "A careful study");
    await change("#builder-label-0", "Original prompt");
    await click("Use questionnaire");

    expect(host.textContent).toContain("Checker feedback for retention-study.html");
    expect(mocks.files).toHaveLength(1);
    const firstHtml = await fileText(mocks.files[0]);
    expect(firstHtml).toContain("Original prompt");

    await click("Edit questionnaire");
    expect((host.querySelector("#builder-label-0") as HTMLInputElement).value).toBe("Original prompt");
    await change("#builder-label-0", "Corrected prompt");
    await click("Use questionnaire");

    expect(mocks.files).toHaveLength(2);
    const revisedHtml = await fileText(mocks.files[1]);
    expect(revisedHtml).toContain("Corrected prompt");
    expect(revisedHtml).not.toContain("Original prompt");
  });
});
