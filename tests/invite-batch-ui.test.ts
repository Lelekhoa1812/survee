// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleTab } from "../src/components/PeopleTab";
import type { InterviewData, PersonRow } from "../src/components/interview-types";

let host: HTMLDivElement;
let root: Root;

function person(id: string, name: string, state: PersonRow["mail"]["state"]): PersonRow {
  return {
    id,
    token: `${id}-token`,
    name,
    email: `${id}@example.com`,
    mail: { state, delivery: "unknown" },
    status: "invited",
    answered: 0,
    total: 0,
    requiredMissing: 0,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    answers: {},
  };
}

function batchData(): InterviewData {
  return {
    interview: { id: "111111111111111111111111", name: "Research", mode: "multi", status: "open", currentVersion: 1, createdAt: "2026-11-14T00:00:00.000Z" },
    people: [person("p1", "Ada Lovelace", "unsent"), person("p2", "Grace Hopper", "failed"), person("p3", "Katherine Johnson", "pending"), person("p4", "Margaret Hamilton", "sent")],
    versions: [],
    events: [],
    manifest: { format: "kqa/1", title: "Research", questions: [] },
    publicOrigin: "https://kqa.example",
  } as unknown as InterviewData;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("host invite batches", () => {
  it("only attempts selected eligible people serially after confirmation and shows each outcome", async () => {
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return new Response(JSON.stringify(url.includes("/p1/") ? { ok: true, result: "sent" } : { ok: false, error: "Rate limited." }), { status: url.includes("/p1/") ? 200 : 429, headers: { "content-type": "application/json" } });
    }));
    const refresh = vi.fn();
    await act(async () => root.render(createElement(PeopleTab, { data: batchData(), origin: "https://kqa.example", refresh })));

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Ada Lovelace for invite batch"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Grace Hopper for invite batch"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Katherine Johnson for invite batch"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select Margaret Hamilton for invite batch"]')).toBeNull();

    await act(async () => {
      host.querySelector<HTMLInputElement>('input[aria-label="Select Ada Lovelace for invite batch"]')!.click();
      host.querySelector<HTMLInputElement>('input[aria-label="Select Grace Hopper for invite batch"]')!.click();
    });
    const sendButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Send 2 invites"))!;
    await act(async () => sendButton.click());
    expect(host.textContent).toContain("Send 2 invitations?");
    expect(calls).toHaveLength(0);

    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Send invitations"))!;
    await act(async () => confirm.click());

    expect(calls).toEqual(["/api/admin/people/p1/invite", "/api/admin/people/p2/invite"]);
    expect(maxActive).toBe(1);
    expect(host.textContent).toContain("Ada Lovelace:");
    expect(host.textContent).toContain("Invite sent.");
    expect(host.textContent).toContain("Grace Hopper:");
    expect(host.textContent).toContain("Rate limited.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
