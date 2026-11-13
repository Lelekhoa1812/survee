import { displayValue, progress } from "../format/answers";
import { LIMITS } from "../format/schema";
import { EXPORT_FORMATS, exportInterview, type ExportFormat } from "../export";
import { parseEmail } from "../mail/address";
import { checkInviteDelivery } from "../mail/delivery";
import { sendInvite } from "../mail/invite";
import { inviteLink } from "../mail/policy";
import { currentMail } from "../mail/state";
import {
  addParticipants,
  addVersion,
  createInterview,
  deleteInterview,
  deleteParticipant,
  getInterview,
  getParticipant,
  getVersion,
  listInterviews,
  listParticipants,
  listVersions,
  noteMcp,
  recentEvents,
  regenerateToken,
  reopenParticipant,
  updateInterview,
  updateParticipant,
} from "../repo";
import { listMailByInterview, listMailByPerson, mailRecord } from "../repo/mail";
import { prepareSurvey, withCompat } from "../survey";
import type { Manifest } from "../format/schema";
import type { ParticipantView } from "../repo/types";
import { ObjectId } from "mongodb";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" };
const bool = { type: "boolean" };

function ok(data: Record<string, unknown>, text?: string): ToolResult {
  return { content: [{ type: "text", text: text ?? JSON.stringify(data) }], structuredContent: data, isError: false };
}
function err(error: string, code?: string): ToolResult {
  return { content: [{ type: "text", text: error }], structuredContent: { ok: false, error, ...(code ? { code } : {}) }, isError: true };
}
function asString(value: unknown, max = 500): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}
function oid(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function questionList(manifest: Manifest) {
  return manifest.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: !!q.required, section: q.section ?? null }));
}

function shapePerson(person: ParticipantView, manifest: Manifest | null, rows: ReturnType<typeof mailRecord>[]) {
  const mail = currentMail(person, rows);
  const link = inviteLink(person.token);
  const pr = manifest ? progress(manifest, person.answers) : null;
  return {
    id: person.id,
    interviewId: person.interviewId,
    name: person.name,
    email: person.email ?? null,
    note: person.note ?? null,
    status: person.status,
    link: link.ok ? link.link : null,
    answered: pr?.answered ?? 0,
    total: pr?.total ?? 0,
    requiredMissing: pr?.missingRequired.length ?? 0,
    lastSavedAt: person.lastSavedAt ?? null,
    submittedAt: person.submittedAt ?? null,
    mail: {
      state: mail.state,
      sentAt: mail.sentAt ?? null,
      error: mail.error ?? null,
      delivery: mail.state === "sent" ? mail.delivery : "unknown",
      deliveryCheckedAt: mail.deliveryCheckedAt ?? null,
      detail: mail.deliveryDetail ?? null,
    },
  };
}

async function loadPeople(interviewId: string) {
  const interview = await getInterview(interviewId);
  if (!interview) return null;
  const version = await getVersion(interview._id, interview.currentVersion);
  const people = await listParticipants(interviewId);
  const mail = await listMailByInterview(interview._id);
  const grouped = new Map<string, ReturnType<typeof mailRecord>[]>();
  for (const row of mail) {
    const id = row.participantId.toHexString();
    grouped.set(id, [...(grouped.get(id) ?? []), mailRecord(row)]);
  }
  return { interview, version, people: people.map((p) => shapePerson(p, version?.manifest ?? null, grouped.get(p.id) ?? [])) };
}

async function onePerson(personId: string) {
  const person = await getParticipant(personId);
  if (!person) return null;
  const interview = await getInterview(person.interviewId);
  const version = interview ? await getVersion(interview._id, interview.currentVersion) : null;
  const id = oid(person.id);
  const rows = id ? (await listMailByPerson(id)).map(mailRecord) : [];
  return { person, interview, version, view: shapePerson(person, version?.manifest ?? null, rows) };
}

const TOOLS: ToolDef[] = [
  {
    name: "list_interviews",
    description: "List the host's interviews with open/closed status and people counts.",
    inputSchema: obj({}),
    async run() {
      const interviews = await listInterviews();
      return ok({ interviews });
    },
  },
  {
    name: "get_interview",
    description: "Read one interview and its current question list. HTML is omitted.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      return ok({
        id: interview._id.toHexString(),
        name: interview.name,
        description: interview.description ?? null,
        mode: interview.mode,
        status: interview.status,
        currentVersion: interview.currentVersion,
        questions: version ? questionList(version.manifest) : [],
      });
    },
  },
  {
    name: "get_survey_html",
    description: "Read a stored questionnaire file.",
    inputSchema: obj({ interviewId: str, version: { type: "integer" } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const versionNo = typeof args.version === "number" && Number.isInteger(args.version) ? args.version : interview.currentVersion;
      const version = await getVersion(interview._id, versionNo);
      if (!version) return err("Survey version not found.", "not_found");
      return ok({ version: version.version, fileName: version.fileName ?? null, html: version.html, manifest: version.manifest });
    },
  },
  {
    name: "list_versions",
    description: "List uploaded questionnaire versions without the HTML.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const versions = await listVersions(interview._id);
      return ok({
        versions: versions.map((v) => ({ version: v.version, fileName: v.fileName ?? null, bytes: v.bytes, questions: v.manifest.questions.length, check: v.check, createdAt: v.createdAt.toISOString() })),
      });
    },
  },
  {
    name: "check_questionnaire",
    description: "Run the checker. Nothing is stored.",
    inputSchema: obj({ html: str, fileName: str, interviewId: str }, ["html"]),
    async run(args) {
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      let prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      const interviewId = asString(args.interviewId, 40);
      if (interviewId) prepared = await withCompat(prepared, interviewId);
      return ok({ ok: prepared.report.ok, markdown: prepared.markdown, counts: prepared.report.counts, diagnostics: prepared.report.diagnostics });
    },
  },
  {
    name: "list_people",
    description: "List people on an interview, including email, status, progress, mail state, and private link.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const loaded = await loadPeople(id);
      if (!loaded) return err("Interview not found.", "not_found");
      return ok({ people: loaded.people });
    },
  },
  {
    name: "get_person",
    description: "Read one person, their private link, and their invite state.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const loaded = await onePerson(id);
      if (!loaded) return err("Person not found.", "not_found");
      return ok({ person: loaded.view });
    },
  },
  {
    name: "get_answers",
    description: "Read answers for review. display is the label a host sees. There is no score.",
    inputSchema: obj({ interviewId: str, personId: str, submittedOnly: bool }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      const only = asString(args.personId, 40);
      let people = await listParticipants(id);
      if (only) people = people.filter((p) => p.id === only);
      if (args.submittedOnly === true) people = people.filter((p) => p.status === "submitted");
      const rows = people.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        submittedAt: p.submittedAt ?? null,
        answers: version.manifest.questions.map((q) => {
          const stored = p.answers[q.id];
          return { questionId: q.id, type: q.type, label: q.label, value: stored?.value ?? null, display: displayValue(q, stored?.value), note: stored?.note ?? null, updatedAt: stored?.updatedAt ?? null };
        }),
      }));
      return ok({ interviewStatus: interview.status, people: rows });
    },
  },
  {
    name: "get_status",
    description: "Interview open/closed, version, and per-person progress.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const loaded = await loadPeople(id);
      if (!loaded) return err("Interview not found.", "not_found");
      const counts = { invited: 0, in_progress: 0, submitted: 0 };
      for (const p of loaded.people) counts[p.status] += 1;
      return ok({
        interviewId: id,
        name: loaded.interview.name,
        status: loaded.interview.status,
        currentVersion: loaded.interview.currentVersion,
        counts,
        people: loaded.people.map((p) => ({ id: p.id, name: p.name, status: p.status, answered: p.answered, total: p.total, requiredMissing: p.requiredMissing, mail: p.mail.state })),
      });
    },
  },
  {
    name: "list_events",
    description: "Recent audit events for an interview.",
    inputSchema: obj({ interviewId: str, limit: { type: "integer" } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      if (!(await getInterview(id))) return err("Interview not found.", "not_found");
      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(50, Math.floor(args.limit)) : 30;
      return ok({ events: await recentEvents(id, limit) });
    },
  },
  {
    name: "export_interview",
    description: "Export answers in a format the host can already download.",
    inputSchema: obj({ interviewId: str, format: { type: "string", enum: [...EXPORT_FORMATS] } }, ["interviewId", "format"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      const format = args.format as ExportFormat;
      if (!id) return err("interviewId is required.");
      if (!EXPORT_FORMATS.includes(format)) return err(`format must be one of ${EXPORT_FORMATS.join(", ")}.`);
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      const people = await listParticipants(id);
      const file = await exportInterview(
        {
          interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, createdAt: interview.createdAt.toISOString() },
          manifest: version.manifest,
          surveyVersion: version.version,
          participants: people.map((p) => ({ id: p.id, name: p.name, note: p.note, status: p.status, createdAt: p.createdAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers })),
          generatedAt: new Date().toISOString(),
        },
        format,
      );
      const binary = typeof file.body !== "string";
      const body = typeof file.body === "string" ? file.body : file.body.toString("base64");
      return ok(
        { filename: file.filename, contentType: file.contentType, encoding: binary ? "base64" : "utf8", body },
        binary ? `Exported ${file.filename}. The file is base64 in structuredContent.` : body,
      );
    },
  },
  {
    name: "get_mail_status",
    description: "Read stored invite results. Does not open the mailbox.",
    inputSchema: obj({ personId: str, interviewId: str }),
    async run(args) {
      const personId = asString(args.personId, 40);
      const interviewId = asString(args.interviewId, 40);
      if (!personId && !interviewId) return err("personId or interviewId is required.");
      if (personId) {
        const loaded = await onePerson(personId);
        if (!loaded) return err("Person not found.", "not_found");
        return ok({ people: [{ id: loaded.view.id, email: loaded.view.email, mail: loaded.view.mail }] });
      }
      const loaded = await loadPeople(interviewId!);
      if (!loaded) return err("Interview not found.", "not_found");
      return ok({ people: loaded.people.map((p) => ({ id: p.id, name: p.name, email: p.email, mail: p.mail })) });
    },
  },
  {
    name: "create_interview",
    description: "Create an interview from a questionnaire file. A failed check stores nothing.",
    inputSchema: obj({ name: str, description: str, mode: { type: "string", enum: ["single", "multi"] }, html: str, fileName: str }, ["name", "mode", "html"]),
    async run(args) {
      const name = asString(args.name, 120);
      if (!name) return err("Give the interview a name.");
      if (args.mode !== "single" && args.mode !== "multi") return err("mode must be single or multi.");
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      const prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The file did not pass the checker.", "checker"), structuredContent: { ok: false, error: "The file did not pass the checker.", code: "checker", markdown: prepared.markdown } };
      }
      const doc = await createInterview({ name, description: asString(args.description, 500) || undefined, mode: args.mode, survey: prepared.survey });
      return ok({ id: doc._id.toHexString(), interviewId: doc._id.toHexString(), report: { ok: true, counts: prepared.report.counts } });
    },
  },
  {
    name: "update_interview",
    description: "Rename an interview, edit its notes, or open or close it.",
    inputSchema: obj({ interviewId: str, name: str, description: str, status: { type: "string", enum: ["open", "closed"] } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const patch: { name?: string; description?: string | null; status?: "open" | "closed" } = {};
      if (args.name !== undefined) {
        const name = asString(args.name, 120);
        if (!name) return err("The name cannot be empty.");
        patch.name = name;
      }
      if (args.description !== undefined) patch.description = asString(args.description, 500) ?? null;
      if (args.status !== undefined) {
        if (args.status !== "open" && args.status !== "closed") return err("Status must be open or closed.");
        patch.status = args.status;
      }
      const updated = await updateInterview(id, patch);
      return updated ? ok({ ok: true, interviewId: id }) : err("Interview not found.", "not_found");
    },
  },
  {
    name: "delete_interview",
    description: "Delete an interview, its versions, people, answers, and invite history. confirmName must match exactly.",
    inputSchema: obj({ interviewId: str, confirmName: str }, ["interviewId", "confirmName"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (args.confirmName !== interview.name) return err("Type the interview name exactly to confirm deleting it.");
      await deleteInterview(id);
      return ok({ ok: true });
    },
  },
  {
    name: "upload_survey_version",
    description: "Replace the live questionnaire. A failed check stores nothing.",
    inputSchema: obj({ interviewId: str, html: str, fileName: str }, ["interviewId", "html"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      if (!(await getInterview(id))) return err("Interview not found.", "not_found");
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      const prepared = await withCompat(prepareSurvey(args.html, asString(args.fileName, 200)), id);
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The file did not pass the checker.", "checker"), structuredContent: { ok: false, error: "The file did not pass the checker.", markdown: prepared.markdown } };
      }
      const version = await addVersion(id, prepared.survey);
      return version ? ok({ version, interviewId: id, report: { ok: true, counts: prepared.report.counts } }) : err("Interview not found.", "not_found");
    },
  },
  {
    name: "add_people",
    description: "Add people to a multi-user interview. Email is optional. One-person interviews cannot add people.",
    inputSchema: obj({ interviewId: str, people: { type: "array", items: obj({ name: str, email: str, note: str }, ["name"]) } }, ["interviewId", "people"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (interview.mode !== "multi") return err("This interview is in One person mode, so it has a single link.");
      if (!Array.isArray(args.people)) return err("people must be a list.");
      const people: { name: string; email?: string; note?: string }[] = [];
      for (const raw of args.people.slice(0, 100)) {
        if (!raw || typeof raw !== "object") return err("Each person needs a name.");
        const item = raw as Record<string, unknown>;
        const name = asString(item.name, 120);
        if (!name) return err("Each person needs a name.");
        let email: string | undefined;
        if (item.email !== undefined && item.email !== null && item.email !== "") {
          if (typeof item.email !== "string") return err("That does not look like an email address.");
          const parsed = parseEmail(item.email);
          if (!parsed.ok || !parsed.email) return err(parsed.ok ? "That does not look like an email address." : parsed.error);
          email = parsed.email;
        }
        people.push({ name, email, note: asString(item.note, 1000) });
      }
      if (!people.length) return err("Add at least one person with a name.");
      const created = await addParticipants(id, people);
      const loaded = await loadPeople(id);
      const views = loaded ? created.map((p) => loaded.people.find((row) => row.id === p.id) ?? shapePerson(p, null, [])) : created.map((p) => shapePerson(p, null, []));
      return ok({ people: views });
    },
  },
  {
    name: "update_person",
    description: "Change a person's name, optional email, or private note. An empty email clears it and does not send.",
    inputSchema: obj({ personId: str, name: str, email: str, note: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const patch: { name?: string; email?: string | null; note?: string | null } = {};
      if (args.name !== undefined) {
        const name = asString(args.name, 120);
        if (!name) return err("The name cannot be empty.");
        patch.name = name;
      }
      if (args.email !== undefined) {
        if (args.email === null || args.email === "") patch.email = null;
        else if (typeof args.email !== "string") return err("That does not look like an email address.");
        else {
          const parsed = parseEmail(args.email);
          if (!parsed.ok) return err(parsed.error);
          patch.email = parsed.email;
        }
      }
      if (args.note !== undefined) patch.note = args.note === null ? null : (asString(args.note, 1000) ?? null);
      if (!Object.keys(patch).length) return err("Nothing to update.");
      const updated = await updateParticipant(id, patch);
      if (!updated) return err("Person not found.", "not_found");
      const loaded = await onePerson(id);
      return ok({ person: loaded?.view ?? shapePerson(updated, null, []) });
    },
  },
  {
    name: "remove_person",
    description: "Remove a person, their answers, and their invite history.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      return (await deleteParticipant(id)) ? ok({ ok: true }) : err("Person not found.", "not_found");
    },
  },
  {
    name: "reopen_person",
    description: "Unlock a submitted person so they can edit again.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const person = await reopenParticipant(id);
      if (!person) return err("That person has not submitted, so there is nothing to reopen.");
      const loaded = await onePerson(id);
      return ok({ person: loaded?.view ?? shapePerson(person, null, []) });
    },
  },
  {
    name: "regenerate_link",
    description: "Replace a person's private link. The previous link stops working. Nothing is emailed automatically.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const token = await regenerateToken(id);
      if (!token) return err("Person not found.", "not_found");
      const link = inviteLink(token);
      return ok({ token, link: link.ok ? link.link : null, interviewId: (await getParticipant(id))?.interviewId });
    },
  },
  {
    name: "send_invite",
    description: "Email one person their private link. Refuses when they have no email, the interview is closed, or the public URL is unset. Does not send a second message unless resend is true.",
    inputSchema: obj({ personId: str, resend: bool }, ["personId"]),
    async run(args) {
      if ("personIds" in args || Array.isArray(args.personId)) return err("Send to one person at a time.");
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const result = await sendInvite({ personId: id, triggeredBy: "mcp", resend: args.resend === true });
      if (!result.ok) return err(result.error, result.code);
      return ok({ result: result.result, to: result.to, sentAt: result.sentAt, interviewId: result.interviewId, personId: result.personId });
    },
  },
  {
    name: "check_invite_delivery",
    description: "Connect briefly over IMAP and look up only the message id KQA stored for this person's current invite. Returns delivered, bounced, or unknown.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      if ("query" in args || "mailbox" in args || "search" in args || "messageId" in args) {
        return err("Delivery checks only the invites KQA has sent for this person. It does not search a mailbox.");
      }
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const result = await checkInviteDelivery(id);
      if (!result.ok) return err(result.error, result.code);
      const label = result.delivery === "delivered" ? "Delivered" : result.delivery === "bounced" ? "Bounced" : "Not confirmed yet";
      return ok({ delivery: result.delivery, label, detail: result.detail ?? null, checkedAt: result.checkedAt, personId: result.personId, interviewId: result.interviewId });
    },
  },
];

export function listToolDefs() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function dispatchTool(name: string, args: unknown): Promise<ToolResult> {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) return err(`Unknown tool: ${name}`);
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const interviewId = typeof record.interviewId === "string" ? record.interviewId : undefined;
  try {
    const result = await tool.run(record);
    const fromResult = typeof result.structuredContent.interviewId === "string" ? result.structuredContent.interviewId : interviewId;
    await noteMcp(tool.name, !result.isError, fromResult).catch(() => {});
    return result;
  } catch {
    await noteMcp(tool.name, false, interviewId).catch(() => {});
    return err("That could not be done.");
  }
}
