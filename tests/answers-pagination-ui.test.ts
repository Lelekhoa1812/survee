// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewData, PersonRow } from "../src/components/interview-types";

const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../src/components/ui", () => ({
  api: state.api,
  Badge: ({ children }: { children: unknown }) => createElement("span", null, children as never),
  Icon: () => null,
  Modal: ({ children }: { children: unknown }) => createElement("div", null, children as never),
  Spinner: () => createElement("span", null, "Loading"),
}));
vi.mock("../src/components/PreviewFrame", () => ({ PreviewFrame: () => null }));

import { AnswersTab } from "../src/components/AnswersTab";

const question = { id: "q1", type: "text", label: "Your response", required: false };
function participant(id: string, name: string): PersonRow {
  return {
    id, token: `token-${id}`, name, status: "submitted", answered: 1, total: 1, requiredMissing: 0,
    createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
    submittedAt: "2026-11-23T00:00:00.000Z", answers: { q1: { value: name, updatedAt: "2026-11-23T00:00:00.000Z" } },
    mail: { state: "unsent", delivery: "unknown" },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.api.mockReset().mockResolvedValue({ ok: true, data: { people: [participant("older", "Older respondent")], nextCursor: null } });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("host answer pagination", () => {
  it("loads another bounded page and appends the respondent details", async () => {
    const data = {
      interview: { id: "interview-1", name: "Study", mode: "multi", status: "open", currentVersion: 1, createdAt: "2026-11-23T00:00:00.000Z" },
      counts: { people: 2, invited: 0, inProgress: 0, submitted: 2 },
      manifest: { format: "kqa/1", title: "Study", questions: [question], sections: [] },
      publicOrigin: null, versions: [], events: [], people: [participant("newest", "Newest respondent")],
      peopleNextCursor: "cursor-older", answersIncluded: true,
    } as unknown as InterviewData;
    act(() => root.render(createElement(AnswersTab, { data })));

    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Load more answers"))!;
    await act(async () => { button.click(); });

    expect(state.api).toHaveBeenCalledWith("/api/admin/interviews/interview-1/participants?cursor=cursor-older&includeAnswers=1");
    expect(host.textContent).toContain("Newest respondent");
    expect(host.textContent).toContain("Older respondent");
    expect(host.textContent).not.toContain("Load more answers");
  });
});
