// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMembersPanel } from "../src/components/WorkspaceMembersPanel";

const state = vi.hoisted(() => ({ api: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("../src/components/ui", () => ({
  api: state.api,
  Icon: () => null,
  Spinner: () => null,
  useToast: () => vi.fn(),
  Modal: ({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) => createElement("div", { role: "dialog" }, createElement("h2", null, title), children, actions),
}));

let host: HTMLDivElement;
let root: Root;
async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { button.click(); });
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.refresh.mockReset();
  state.api.mockReset().mockImplementation(async (url: string) => url === "/api/admin/workspace-invitations"
    ? { ok: true, data: { ownerCount: 1, invitationHistory: [{ id: "event-1", invitationId: "aaaaaaaaaaaaaaaaaaaaaa111111", type: "workspace_invitation_accepted", at: "2026-11-23T00:00:00.000Z", actorUserId: "000000000000000000000002", targetUserId: "000000000000000000000002", role: "member" }], members: [
      { userId: "000000000000000000000001", email: "owner@example.test", role: "owner", createdAt: "2026-11-01T00:00:00.000Z" },
      { userId: "000000000000000000000002", email: "member@example.test", role: "member", createdAt: "2026-11-02T00:00:00.000Z" },
    ], invitations: [] } }
    : { ok: true, data: {} });
  await act(async () => root.render(createElement(WorkspaceMembersPanel, { role: "owner", userId: "000000000000000000000001" })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("workspace owner transfer UI", () => {
  it("shows bounded invitation lifecycle history without exposing recipient addresses", () => {
    expect(host.textContent).toContain("Recent invitation history");
    expect(host.textContent).toContain("member@example.test accepted a member invitation");
    expect(host.textContent).toContain("Invitation ending …111111");
    expect(host.textContent).toContain("retained for up to 180 days");
  });

  it("requires explicit confirmation and refreshes access after the transactional transfer", async () => {
    await click("Make owner");
    expect(host.textContent).toContain("Transfer workspace ownership to member@example.test?");
    expect(host.textContent).toContain("Your role will change to admin");

    await click("Transfer ownership");
    expect(state.api).toHaveBeenCalledWith("/api/admin/workspaces/transfer-ownership", {
      method: "POST", body: { targetUserId: "000000000000000000000002" },
    });
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("confirms and saves a non-owner role change", async () => {
    await click("Change role");
    expect(host.textContent).toContain("Change member@example.test's workspace role?");
    const select = host.querySelector('[role="dialog"] select') as HTMLSelectElement;
    await act(async () => {
      select.value = "admin";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Save role");
    expect(state.api).toHaveBeenCalledWith("/api/admin/workspace-members/000000000000000000000002", {
      method: "PATCH", body: { role: "admin" },
    });
  });
});
