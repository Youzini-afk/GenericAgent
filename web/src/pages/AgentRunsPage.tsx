import { CircleStop, Play, Plus, RefreshCw, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { CliRun, CliEnvProfile, CliRunEvent } from "../lib/types";
import type { T } from "../lib/i18n";
import { shortId, fmtTime, asText, changedCount, orchestrationMeta, statusLabel, cliStatusClass, policyLabel } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { useCliRunStream } from "../useCliRunStream";
import { StatusIcon } from "../components/common/StatusIcon";
import { Shimmer } from "../components/common/Shimmer";
import { DiffViewer } from "../components/common/DiffViewer";
import { api } from "../api";

const FINAL = ["done", "error", "canceled"];

function CreateRunModal({ token, t, profiles, onCreated, onClose }: {
  token: string; t: T; profiles: CliEnvProfile[];
  onCreated: (run: CliRun) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    provider: "codex", mode: "implement", provider_reason: "", prompt: "",
    target_workspace: "/data/workspace", write_intent: true, allow_write: true,
    allow_tests: true, allow_install: false, allow_network: true,
    allow_commit: false, allow_push: false, env_profile_id: ""
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const policy = {
        allow_write: form.allow_write, allow_tests: form.allow_tests,
        allow_install: form.allow_install, allow_network: form.allow_network,
        allow_commit: form.allow_commit, allow_push: form.allow_push,
        _orchestration: { mode: form.mode, provider_reason: form.provider_reason }
      };
      const run = await api<CliRun>("/api/cli-runs", token, {
        method: "POST",
        body: JSON.stringify({ provider: form.provider, prompt: form.prompt, target_workspace: form.target_workspace, write_intent: form.write_intent, policy, env_profile_id: form.env_profile_id || null })
      });
      onCreated(run);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t("agentRuns.create")}</span>
          <button type="button" className="icon-btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          <div className="form-row">
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="codex">Codex</option>
              <option value="claude_code">Claude Code</option>
              <option value="opencode">OpenCode</option>
              <option value="custom_shell">Custom Shell</option>
            </select>
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="implement">implement</option>
              <option value="analyze">analyze</option>
              <option value="review">review</option>
              <option value="verify">verify</option>
            </select>
          </div>
          <input value={form.target_workspace} onChange={(e) => setForm({ ...form, target_workspace: e.target.value })} placeholder="Workspace path" />
          {profiles.length > 0 && (
            <select value={form.env_profile_id} onChange={(e) => setForm({ ...form, env_profile_id: e.target.value })}>
              <option value="">{t("agentRuns.noEnvProfile")}</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input value={form.provider_reason} onChange={(e) => setForm({ ...form, provider_reason: e.target.value })} placeholder={t("agentRuns.providerReason")} />
          <textarea className="modal-prompt" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Task prompt…" rows={5} />
          <div className="toggle-grid">
            {(["write_intent", "allow_write", "allow_tests", "allow_install", "allow_network", "allow_commit", "allow_push"] as const).map((key) => (
              <label className="checkline" key={key}>
                <input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                {policyLabel(t, key)}
              </label>
            ))}
          </div>
          <div className="modal-footer">
            <button type="button" className="ghost-btn" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-btn" type="submit" disabled={!form.prompt.trim() || busy}>
              <Play size={14} />{t("common.run")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RunDetail({ run, events, diff, result, t }: {
  run: CliRun; events: CliRunEvent[]; diff: string; result: Record<string, unknown>; t: T;
}) {
  const meta = orchestrationMeta(run);
  const isActive = ["pending", "preparing", "running"].includes(run.status);
  return (
    <Tabs.Root defaultValue="events" className="run-detail-tabs">
      <div className="run-detail-header">
        <div className="run-detail-meta">
          <StatusIcon status={run.status} size={11} />
          <span className="run-detail-provider">{run.provider}</span>
          {meta.mode && <span className="run-detail-mode">{meta.mode}</span>}
          <span className={`run-status-badge ${run.status}`}>
            {isActive ? <Shimmer>{statusLabel(t, run.status)}</Shimmer> : statusLabel(t, run.status)}
          </span>
        </div>
        <Tabs.List className="run-tabs-list">
          <Tabs.Trigger value="events" className="run-tab">{t("tabs.events")}</Tabs.Trigger>
          <Tabs.Trigger value="diff" className="run-tab">{t("tabs.diff")}</Tabs.Trigger>
          <Tabs.Trigger value="result" className="run-tab">{t("tabs.result")}</Tabs.Trigger>
        </Tabs.List>
      </div>
      <div className="run-detail-body">
        <Tabs.Content value="events" className="run-tab-content">
          <pre className="event-log">{events.map((e) => `[${e.type}] ${asText(e.payload.text || e.payload.status || e.payload.error)}\n`).join("") || (isActive ? "Waiting…" : t("common.noOutput"))}</pre>
        </Tabs.Content>
        <Tabs.Content value="diff" className="run-tab-content">
          <DiffViewer content={diff} t={t} />
        </Tabs.Content>
        <Tabs.Content value="result" className="run-tab-content">
          {result.summary != null && <p className="result-summary">{String(result.summary)}</p>}
          {Array.isArray(result.changed_files) && result.changed_files.length > 0 && (
            <div className="result-section">
              <div className="result-label">{t("agentRuns.changedFiles")} ({changedCount(result)})</div>
              {(result.changed_files as string[]).map((f, i) => <div key={i} className="result-file">{f}</div>)}
            </div>
          )}
          {Array.isArray(result.blockers) && result.blockers.length > 0 && (
            <div className="result-section">
              <div className="result-label danger">{t("agentRuns.blockers")}</div>
              {(result.blockers as string[]).map((b, i) => <div key={i} className="result-blocker">{b}</div>)}
            </div>
          )}
          {result.summary == null && !Array.isArray(result.changed_files) && (
            <pre className="event-log">{asText(result) || t("common.noOutput")}</pre>
          )}
        </Tabs.Content>
      </div>
      <div className="run-detail-footer">
        <span className="run-workspace">{run.effective_workspace || run.target_workspace}</span>
      </div>
    </Tabs.Root>
  );
}

export function AgentRunsPage({ token, t, selectedRunId, onSelectedRun }: {
  token: string; t: T; selectedRunId?: string; onSelectedRun?: (runId: string) => void;
}) {
  const runs = useAsyncData<{ items: CliRun[] }>(token, "/api/cli-runs", { items: [] }, 2500);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 5000);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelectedState] = useState(selectedRunId || "");
  const [diff, setDiff] = useState("");
  const [result, setResult] = useState<Record<string, unknown>>({});
  const events = useCliRunStream(selected, token);
  const lastEvent = events[events.length - 1];
  const selectedRun = runs.data.items.find((r) => r.id === selected);

  function setSelected(id: string) { setSelectedState(id); onSelectedRun?.(id); }

  useEffect(() => { if (selectedRunId && selectedRunId !== selected) setSelectedState(selectedRunId); }, [selectedRunId, selected]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const [d, r] = await Promise.all([
      api<{ content: string }>(`/api/cli-runs/${selected}/diff`, token),
      api<Record<string, unknown>>(`/api/cli-runs/${selected}/result`, token)
    ]);
    setDiff(d.content); setResult(r);
  }, [selected, token]);

  useEffect(() => { if (!selected) { setDiff(""); setResult({}); return; } loadDetail().catch(() => undefined); }, [loadDetail, selected]);
  useEffect(() => { if (lastEvent && FINAL.includes(lastEvent.type)) { loadDetail().catch(() => undefined); runs.refresh().catch(() => undefined); } }, [lastEvent, loadDetail]);

  return (
    <div className="agent-runs-layout">
      {/* 左侧：运行列表 */}
      <div className="runs-pane">
        <div className="runs-pane-header">
          <span className="runs-pane-title">{t("nav.agentRuns")}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className="icon-btn-ghost" title={t("common.refresh")} onClick={runs.refresh}><RefreshCw size={14} /></button>
            <button type="button" className="create-run-btn" onClick={() => setShowCreate(true)}><Plus size={14} />{t("agentRuns.create")}</button>
          </div>
        </div>
        <div className="runs-list">
          {runs.data.items.length === 0 && <div className="empty-state">{t("agentRuns.selectRun")}</div>}
          {runs.data.items.map((run) => {
            const meta = orchestrationMeta(run);
            const isActive = ["pending", "preparing", "running"].includes(run.status);
            return (
              <button key={run.id} type="button" className={`run-row${selected === run.id ? " active" : ""}`} onClick={() => setSelected(run.id)}>
                <span className="run-row-icon"><StatusIcon status={run.status} size={11} /></span>
                <div className="run-row-body">
                  <div className="run-row-top">
                    <span className="run-row-provider">{run.provider}</span>
                    {meta.mode && <span className="run-row-mode">{meta.mode}</span>}
                    <span className={`run-row-status ${run.status}`}>
                      {isActive ? <Shimmer>{statusLabel(t, run.status)}</Shimmer> : statusLabel(t, run.status)}
                    </span>
                  </div>
                  <div className="run-row-bottom">
                    <span className="run-row-time">{fmtTime(run.updated_at)}</span>
                    {changedCount(run.result) > 0 && <span className="run-row-files">{changedCount(run.result)} files</span>}
                  </div>
                </div>
                {isActive && (
                  <button type="button" className="icon-btn-ghost danger run-cancel" title={t("agentRuns.cancel")}
                    onClick={(e) => { e.stopPropagation(); api(`/api/cli-runs/${run.id}/cancel`, token, { method: "POST" }).then(() => runs.refresh()); }}>
                    <CircleStop size={13} />
                  </button>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧：详情 */}
      <div className="run-detail-pane">
        {selectedRun
          ? <RunDetail run={selectedRun} events={events} diff={diff} result={result} t={t} />
          : <div className="empty-state centered">{t("agentRuns.selectRun")}</div>
        }
      </div>

      {showCreate && (
        <CreateRunModal token={token} t={t} profiles={profiles.data.items}
          onCreated={(run) => { setSelected(run.id); setShowCreate(false); runs.refresh(); }}
          onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
