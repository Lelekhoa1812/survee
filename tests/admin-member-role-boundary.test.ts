import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ParticipantReadLimitError: class ParticipantReadLimitError extends Error { limit = 100; },
  role: "member" as "owner" | "admin" | "member",
  listInterviews: vi.fn(async () => [{ id: "interview-1", counts: { people: 2, invited: 1, inProgress: 0, submitted: 1 } }]),
  getInterview: vi.fn(async () => ({ _id: "interview-1", name: "Study", currentVersion: 1, mode: "multi", status: "open" })),
  getVersion: vi.fn(async () => ({ version: 1, manifest: { title: "Study", questions: [{ id: "assets", type: "repeat", label: "Assets", fields: [{ id: "name", type: "text", label: "Name" }] }] } })),
  listParticipants: vi.fn(async () => [{ id: "person-1", name: "Respondent", status: "submitted" as const, createdAt: "2026-01-01T00:00:00.000Z", answers: {}, recordGroups: { assets: [{ id: "row-1", values: { name: "Pump" } }] } }]),
  listVersions: vi.fn(async () => [{ version: 1, html: "<html></html>" }]),
  recentEvents: vi.fn(async () => [{ id: "event-1", type: "submit", participantId: "person-1", meta: { email: "private@example.test" } }]),
  updateInterview: vi.fn(async () => ({ _id: "interview-1" })),
  deleteInterview: vi.fn(async () => true),
  createInterview: vi.fn(async () => ({ _id: "interview-1" })),
  publishVersionIfCurrent: vi.fn(async () => ({ version: 2 })),
  listImageAssets: vi.fn(async () => ({ assets: [], nextCursor: null })),
  addImageAsset: vi.fn(),
  renameImageAsset: vi.fn(),
  deleteImageAsset: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "signed-session" }) }),
  headers: async () => new Headers({ origin: "https://kqa.test", host: "kqa.test" }),
}));
vi.mock("../src/lib/auth", () => ({
  SESSION_COOKIE: "kqa_admin",
  verifySession: () => ({ userId: "000000000000000000000001", tenantId: "tenant-1", email: "member@example.test", role: state.role, authVersion: 0, sid: "session-1", exp: Math.floor(Date.now() / 1000) + 3600 }),
}));
vi.mock("../src/lib/repo", () => ({
  isSessionRevoked: async () => false,
  listInterviews: state.listInterviews,
  getInterview: state.getInterview,
  getVersion: state.getVersion,
  listParticipants: state.listParticipants,
  ParticipantReadLimitError: state.ParticipantReadLimitError,
  listVersions: state.listVersions,
  recentEvents: state.recentEvents,
  updateInterview: state.updateInterview,
  deleteInterview: state.deleteInterview,
  createInterview: state.createInterview,
  publishVersionIfCurrent: state.publishVersionIfCurrent,
}));
vi.mock("../src/lib/repo/accounts", () => ({
  loadAccountPrincipal: async () => ({ userId: "000000000000000000000001", tenantId: "tenant-1", email: "member@example.test", role: state.role, tenantName: "Workspace", emailVerified: true, legacyBootstrap: false, authVersion: 0 }),
}));
vi.mock("../src/lib/repo/assets", () => ({
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
  listImageAssets: state.listImageAssets,
  addImageAsset: state.addImageAsset,
  renameImageAsset: state.renameImageAsset,
  deleteImageAsset: state.deleteImageAsset,
}));

import { GET as listInterviews } from "../src/app/api/admin/interviews/route";
import { GET as getInterview, PATCH as patchInterview, DELETE as deleteInterview } from "../src/app/api/admin/interviews/[id]/route";
import { POST as createInterview } from "../src/app/api/admin/interviews/route";
import { GET as exportInterview } from "../src/app/api/admin/interviews/[id]/export/route";
import { POST as addPeople } from "../src/app/api/admin/interviews/[id]/people/route";
import { POST as versionAction } from "../src/app/api/admin/interviews/[id]/versions/route";
import { PATCH as patchPerson, DELETE as deletePerson } from "../src/app/api/admin/people/[pid]/route";
import { POST as personAction } from "../src/app/api/admin/people/[pid]/[action]/route";
import { POST as uploadAsset } from "../src/app/api/admin/assets/route";
import { PATCH as renameAsset, DELETE as deleteAsset } from "../src/app/api/admin/assets/[id]/route";

const interviewCtx = { params: Promise.resolve({ id: "0123456789abcdef01234567" }) };
const personCtx = { params: Promise.resolve({ pid: "0123456789abcdef01234567" }) };
const actionCtx = { params: Promise.resolve({ pid: "0123456789abcdef01234567", action: "reopen" }) };
const assetCtx = { params: Promise.resolve({ id: "0123456789abcdef01234567" }) };
const jsonRequest = (path: string, method: string, body: unknown) => new Request(`https://kqa.test${path}`, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.role = "member";
  vi.clearAllMocks();
});

describe("workspace member access boundary", () => {
  it("includes repeat-group records in person-level exports", async () => {
    state.role = "owner";
    state.getInterview.mockResolvedValueOnce({ _id: "0123456789abcdef01234567", name: "Study", currentVersion: 1, mode: "multi", status: "open", createdAt: new Date("2026-01-01T00:00:00.000Z") } as never);
    const response = await exportInterview(new Request("https://kqa.test/api/admin/interviews/0123456789abcdef01234567/export?format=json"), interviewCtx);
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document.participants[0].recordGroups).toEqual({ assets: [{ id: "row-1", values: { name: "Pump" } }] });
  });

  it("returns a clear bounded-export failure when the cohort exceeds the per-request limit", async () => {
    state.role = "owner";
    state.getInterview.mockResolvedValueOnce({ _id: "0123456789abcdef01234567", name: "Study", currentVersion: 1, mode: "multi", status: "open", createdAt: new Date("2026-01-01T00:00:00.000Z") } as never);
    state.listParticipants.mockRejectedValueOnce(new state.ParticipantReadLimitError());
    const response = await exportInterview(new Request("https://kqa.test/api/admin/interviews/0123456789abcdef01234567/export?format=json"), interviewCtx);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "export_participant_limit", limit: 100 });
  });

  it("allows interview summaries and strips respondent records from detail reads", async () => {
    const listResponse = await listInterviews();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({ interviews: [{ counts: { people: 2, submitted: 1 } }] });

    const detailResponse = await getInterview(new Request("https://kqa.test/api/admin/interviews/0123456789abcdef01234567"), interviewCtx);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({ people: [], events: [], versions: [{ version: 1 }] });
    expect(state.listParticipants).not.toHaveBeenCalled();
    expect(state.recentEvents).not.toHaveBeenCalled();
  });

  it("blocks members from respondent data, invitations, publication, and saved changes", async () => {
    const interviewPath = "/api/admin/interviews/0123456789abcdef01234567";
    const personPath = "/api/admin/people/0123456789abcdef01234567";
    const assetPath = "/api/admin/assets/0123456789abcdef01234567";
    const responses = await Promise.all([
      createInterview(jsonRequest("/api/admin/interviews", "POST", {})),
      patchInterview(jsonRequest(interviewPath, "PATCH", { name: "Changed" }), interviewCtx),
      deleteInterview(jsonRequest(interviewPath, "DELETE", { confirmName: "Study" }), interviewCtx),
      exportInterview(new Request(`https://kqa.test${interviewPath}/export?format=json`), interviewCtx),
      addPeople(jsonRequest(`${interviewPath}/people`, "POST", { people: [{ name: "New person" }] }), interviewCtx),
      patchPerson(jsonRequest(personPath, "PATCH", { name: "Changed" }), personCtx),
      deletePerson(new Request(`https://kqa.test${personPath}`, { method: "DELETE" }), personCtx),
      personAction(jsonRequest(`${personPath}/reopen`, "POST", {}), actionCtx),
      versionAction(jsonRequest(`${interviewPath}/versions`, "POST", { action: "apply", html: "<html></html>" }), interviewCtx),
      uploadAsset(new Request("https://kqa.test/api/admin/assets", { method: "POST" })),
      renameAsset(jsonRequest(assetPath, "PATCH", { name: "Changed" }), assetCtx),
      deleteAsset(jsonRequest(assetPath, "DELETE", { confirmName: "Image" }), assetCtx),
    ]);

    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(403));
    expect(state.createInterview).not.toHaveBeenCalled();
    expect(state.updateInterview).not.toHaveBeenCalled();
    expect(state.deleteInterview).not.toHaveBeenCalled();
    expect(state.publishVersionIfCurrent).not.toHaveBeenCalled();
    expect(state.addImageAsset).not.toHaveBeenCalled();
    expect(state.renameImageAsset).not.toHaveBeenCalled();
    expect(state.deleteImageAsset).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("keeps saved interview changes available to %s", async (role) => {
    state.role = role;
    const response = await patchInterview(
      jsonRequest("/api/admin/interviews/0123456789abcdef01234567", "PATCH", { name: "Renamed" }),
      interviewCtx,
    );
    expect(response.status).toBe(200);
    expect(state.updateInterview).toHaveBeenCalledOnce();
  });
});
