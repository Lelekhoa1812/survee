"use client";

import { useEffect, useState } from "react";
import { api, Spinner, useToast } from "./ui";

type Settings = { analyticsMinimumCellSize: number };

export function WorkspaceAnalyticsPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [threshold, setThreshold] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ settings?: Settings }>("/api/admin/workspace-analytics").then((result) => {
      if (!active) return;
      if (!result.ok || !result.data.settings) setError(true);
      else {
        setSettings(result.data.settings);
        setThreshold(result.data.settings.analyticsMinimumCellSize);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!settings || saving) return;
    setSaving(true);
    const result = await api<{ settings?: Settings }>("/api/admin/workspace-analytics", {
      method: "PATCH",
      body: { analyticsMinimumCellSize: threshold },
    });
    setSaving(false);
    if (!result.ok || !result.data.settings) {
      toast(result.data.error || "Workspace analytics settings could not be saved.", "err");
      return;
    }
    setSettings(result.data.settings);
    setThreshold(result.data.settings.analyticsMinimumCellSize);
    toast("Workspace analytics settings saved.");
  }

  if (loading) return <section id="workspace-analytics" className="card settings-anchor"><div className="card-pad"><Spinner /><span className="sr-only">Loading workspace analytics settings</span></div></section>;
  if (error || !settings) return <section id="workspace-analytics" className="card settings-anchor"><div className="card-pad"><h2>Workspace analytics</h2><p className="hint">Workspace analytics settings could not be loaded. Refresh to try again.</p></div></section>;

  return <section id="workspace-analytics" className="card settings-anchor">
    <div className="card-head"><div><h2>Workspace analytics</h2><div className="sub">Set the minimum aggregate reporting group size used across the workspace.</div></div></div>
    <div className="card-pad stack">
      <div className="field">
        <label className="label" htmlFor="minimum-cell-size">Minimum aggregate cell size</label>
        <p className="hint">Aggregate analysis suppresses reported cells and derived values below this size. Default: 5. Operational progress counts and authorized person-level views remain available.</p>
        <input id="minimum-cell-size" type="number" min={2} max={100} step={1} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" type="button" disabled={saving || !Number.isInteger(threshold) || threshold < 2 || threshold > 100} onClick={() => void save()}>{saving ? "Saving…" : "Save analytics settings"}</button>
      </div>
    </div>
  </section>;
}
