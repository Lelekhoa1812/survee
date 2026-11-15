import { checkHtml } from "./diagnostics/static";
import { compareVersions } from "./diagnostics/compat";
import { mergeDiagnostics, toAgentMarkdown } from "./diagnostics/report";
import { CHECKER_VERSION, type Report } from "./diagnostics/types";
import type { NewSurvey } from "./repo";
import { col } from "./db";
import { toOid } from "./repo";
import type { SurveyVersionDoc } from "./repo/types";
import { currentTenantId, tenantFilter } from "./tenant-context";

export interface Prepared {
  report: Report;
  markdown: string;
  survey?: NewSurvey;
}

/** Run the static checker on an uploaded file and, when it passes, shape it for storage. */
export function prepareSurvey(html: string, fileName?: string): Prepared {
  const report = checkHtml(html, { fileName });
  const markdown = toAgentMarkdown(report);
  if (!report.ok || !report.manifest) return { report, markdown };
  const check: SurveyVersionDoc["check"] = {
    errors: report.counts.error, warnings: report.counts.warning, info: report.counts.info, checkedAt: report.checkedAt, checkerVersion: CHECKER_VERSION,
  };
  return { report, markdown, survey: { html: html.replace(/^﻿/, ""), manifest: report.manifest, fileName, check } };
}

/** Add the compatibility findings for replacing the interview's current survey. */
export async function withCompat(prepared: Prepared, interviewId: string): Promise<Prepared> {
  const oid = toOid(interviewId);
  if (!oid || !prepared.report.manifest) return prepared;
  const tenantId = await currentTenantId();
  if (!tenantId) return prepared;
  const interview = await (await col.interviews()).findOne(tenantFilter(tenantId, { _id: oid }));
  if (!interview) return prepared;
  const current = await (await col.versions()).findOne(tenantFilter(tenantId, { interviewId: oid, version: interview.currentVersion }), { projection: { manifest: 1 } });
  if (!current) return prepared;
  const people = await (await col.participants()).find(tenantFilter(tenantId, { interviewId: oid }), { projection: { answers: 1, status: 1 } }).toArray();
  const extra = compareVersions({ previous: current.manifest, next: prepared.report.manifest, answers: people.map((p) => ({ answers: p.answers ?? {}, status: p.status })) });
  if (!extra.length) return prepared;
  const report = mergeDiagnostics(prepared.report, extra);
  return { ...prepared, report, markdown: toAgentMarkdown(report) };
}
