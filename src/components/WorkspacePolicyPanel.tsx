"use client";

import { useEffect, useState } from "react";
import { api, Spinner, useToast } from "./ui";

type Policy = { notice: string; purpose: string; retention: string; contact: string; withdrawal: string; revision: number; updatedAt: string };
type Payload = { analyticsMinimumCellSize: number; respondentPolicy: Policy | null };

const EMPTY = { notice: "", purpose: "", retention: "", contact: "", withdrawal: "" };
function policyForm(policy: Policy | null): typeof EMPTY {
  return policy ? { notice: policy.notice, purpose: policy.purpose, retention: policy.retention, contact: policy.contact, withdrawal: policy.withdrawal } : { ...EMPTY };
}

export function WorkspacePolicyPanel() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [threshold, setThreshold] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ policy?: Payload }>("/api/admin/workspace-policy").then((result) => {
      if (!active) return;
      if (!result.ok || !result.data.policy) {
        setError(true);
      } else {
        setData(result.data.policy);
        setThreshold(result.data.policy.analyticsMinimumCellSize);
        setForm(policyForm(result.data.policy.respondentPolicy));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!data || saving) return;
    setSaving(true);
    const result = await api<{ policy?: Payload }>("/api/admin/workspace-policy", {
      method: "PATCH",
      body: { analyticsMinimumCellSize: threshold, respondentPolicy: form },
    });
    setSaving(false);
    if (!result.ok || !result.data.policy) {
      toast(result.data.error || "Workspace policy could not be saved.", "err");
      return;
    }
    setData(result.data.policy);
    setForm(policyForm(result.data.policy.respondentPolicy));
    toast("Workspace policy saved.");
  }

  if (loading) return <section id="workspace-policy" className="card settings-anchor"><div className="card-pad"><Spinner /><span className="sr-only">Loading workspace policy</span></div></section>;
  if (error || !data) return <section id="workspace-policy" className="card settings-anchor"><div className="card-pad"><h2>Workspace policies</h2><p className="hint">Workspace policy settings could not be loaded. Refresh to try again.</p></div></section>;

  const update = (field: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLTextAreaElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <section id="workspace-policy" className="card settings-anchor">
    <div className="card-head"><div><h2>Workspace policies</h2><div className="sub">Set aggregate reporting and provide your own respondent-facing policy. No legal text or retention duration is prefilled.</div></div></div>
    <div className="card-pad stack">
      <div className="field">
        <label className="label" htmlFor="minimum-cell-size">Minimum aggregate cell size</label>
        <p className="hint">Aggregate analysis suppresses reported cells and derived values below this size. Default: 5. Operational progress counts and authorized person-level views remain available.</p>
        <input id="minimum-cell-size" type="number" min={2} max={100} step={1} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
      </div>
      <div className="field"><label className="label" htmlFor="respondent-notice">Respondent notice</label><textarea id="respondent-notice" rows={5} maxLength={5000} value={form.notice} onChange={update("notice")} placeholder="Leave blank until your workspace has written its own notice." /></div>
      <div className="field"><label className="label" htmlFor="respondent-purpose">Purpose and use</label><textarea id="respondent-purpose" rows={3} maxLength={1000} value={form.purpose} onChange={update("purpose")} placeholder="Optional host-authored description." /></div>
      <div className="field"><label className="label" htmlFor="respondent-retention">Retention information</label><textarea id="respondent-retention" rows={3} maxLength={1000} value={form.retention} onChange={update("retention")} placeholder="Optional host-authored information; this text does not schedule deletion." /></div>
      <div className="field"><label className="label" htmlFor="respondent-contact">Contact information</label><textarea id="respondent-contact" rows={2} maxLength={500} value={form.contact} onChange={update("contact")} placeholder="Optional contact details supplied by your workspace." /></div>
      <div className="field"><label className="label" htmlFor="respondent-withdrawal">Withdrawal instructions</label><textarea id="respondent-withdrawal" rows={3} maxLength={1000} value={form.withdrawal} onChange={update("withdrawal")} placeholder="Optional host-authored instructions. Self-service withdrawal is not enabled by this setting." /></div>
      <div className="row wrap" style={{ justifyContent: "space-between" }}>
        <span className="hint">{data.respondentPolicy ? `Policy revision ${data.respondentPolicy.revision}. Configured text is shown to respondents with an active private link. It does not collect consent, schedule retention deletion, or provide self-service withdrawal.` : "No respondent policy is configured. Blank fields remain absent from respondent pages."}</span>
        <button className="btn primary" type="button" disabled={saving || !Number.isInteger(threshold) || threshold < 2 || threshold > 100} onClick={() => void save()}>{saving ? "Saving…" : "Save workspace policies"}</button>
      </div>
    </div>
  </section>;
}
