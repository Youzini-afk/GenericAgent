import { Activity, CircleStop, ClipboardList, Code2, Play, RefreshCw } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { CliRun, CliEnvProfile } from "../lib/types";
import type { T } from "../lib/i18n";
import { shortId, fmtTime, asText, changedCount, orchestrationMeta, statusLabel, cliStatusClass, policyLabel } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function AgentRunsPage({ token, t, selectedRunId, onSelectedRun }: {
  token: string; t: T; selectedRunId?: string; onSelectedRun?: (runId: string) => void;
}) {
  const runs = useAsyncData<{ items: CliRun[] }>(token, "/api/cli-runs", { items: [] }, 2500);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 5000);
  const [form, setForm] = useState({
    provider: "codex", mode: "implement", provider_reason: "", prompt: "",
    target_workspace: "/data/workspace", write_intent: true, allow_write: true,
    allow_tests: true, allow_install: false, allow_network: true, allow_commit: false, allow_push: false, env_profile_id: ""
  });
  const [selected, setSelectedState] = useState("");
  const [events, setEvents] = useState<Array<{ seq: number; type: string; payload: Record<string, unknown>; created_at: number }>>([]);
  const [diff, setDiff] = useState("");
  const [result, setResult] = useState<Record<string, unknown>>({});
  const selectedRun = runs.data.items.find((item) => item.id === selected);
  const selectedMeta = orchestrationMeta(selectedRun);

  function setSelected(runId: string) {
    setSelectedState(runId);
    onSelectedRun?.(runId);
  }

  useEffect(() => {
    if (selectedRunId && selectedRunId !== selected) setSelectedState(selectedRunId);
  }, [selectedRunId, selected]);

  async function createRun(event: FormEvent) {
    event.preventDefault();
    const policy = {
      allow_write: form.allow_write, allow_tests: form.allow_tests, allow_install: form.allow_install,
      allow_network: form.allow_network, allow_commit: form.allow_commit, allow_push: form.allow_push,
      _orchestration: { mode: form.mode, provider_reason: form.provider_reason }
    };
    const run = await api<CliRun>("/api/cli-runs", token, {
      method: "POST",
      body: JSON.stringify({ provider: form.provider, prompt: form.prompt, target_workspace: form.target_workspace, write_intent: form.write_intent, policy, env_profile_id: form.env_profile_id || null })
    });
    setSelected(run.id);
    setForm({ ...form, prompt: "" });
    await runs.refresh();
  }

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const [eventData, diffData, resultData] = await Promise.all([
      api<{ events: typeof events }>(`/api/cli-runs/${selected}/events?limit=500`, token),
      api<{ content: string }>(`/api/cli-runs/${selected}/diff`, token),
      api<Record<string, unknown>>(`/api/cli-runs/${selected}/result`, token)
    ]);
    setEvents(eventData.events);
    setDiff(diffData.content);
    setResult(resultData);
  }, [selected, token]);

  useEffect(() => {
    loadDetail().catch(() => undefined);
    const timer = window.setInterval(() => loadDetail().catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, [loadDetail]);

  async function cancel(runId: string) {
    await api(`/api/cli-runs/${runId}/cancel`, token, { method: "POST" });
    await runs.refresh();
    await loadDetail();
  }

  return (
    <div className="two-column wide-left">
      <Section title={t("agentRuns.create")} icon={<Code2 size={18} />} actions={<IconButton title={t("common.refresh")} onClick={runs.refresh}><RefreshCw size={16} /></IconButton>}>
        <form className="inline-form run-form" onSubmit={createRun}>
          <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="codex">Codex</option><option value="claude_code">Claude Code</option>
            <option value="opencode">OpenCode</option><option value="custom_shell">Custom Shell</option>
          </select>
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="implement">implement</option><option value="analyze">analyze</option>
            <option value="review">review</option><option value="verify">verify</option>
          </select>
          <input value={form.target_workspace} onChange={(e) => setForm({ ...form, target_workspace: e.target.value })} />
          <select value={form.env_profile_id} onChange={(e) => setForm({ ...form, env_profile_id: e.target.value })}>
            <option value="">{t("agentRuns.noEnvProfile")}</option>
            {profiles.data.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
          <input value={form.provider_reason} onChange={(e) => setForm({ ...form, provider_reason: e.target.value })} placeholder={t("agentRuns.providerReason")} />
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <div className="toggle-grid">
            {(["write_intent", "allow_write", "allow_tests", "allow_install", "allow_network", "allow_commit", "allow_push"] as const).map((key) => (
              <label className="checkline" key={key}>
                <input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                {policyLabel(t, key)}
              </label>
            ))}
          </div>
          <button className="primary-btn" type="submit" disabled={!form.prompt.trim()}><Play size={16} />{t("common.run")}</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("table.id")}</th><th>{t("table.provider")}</th><th>{t("table.status")}</th><th>{t("table.mode")}</th><th>{t("table.updated")}</th><th /></tr></thead>
            <tbody>
              {runs.data.items.map((run) => (
                <tr key={run.id} className={selected === run.id ? "selected-row" : ""}>
                  <td><button className="link-btn" type="button" onClick={() => setSelected(run.id)}>{shortId(run.id)}</button></td>
                  <td>{run.provider}</td>
                  <td><span className={cliStatusClass[run.status]}>{statusLabel(t, run.status)}</span></td>
                  <td>{orchestrationMeta(run).mode || run.workspace_mode || "-"}</td>
                  <td>{fmtTime(run.updated_at)}</td>
                  <td>{["pending", "preparing", "running"].includes(run.status) && (
                    <IconButton title={t("agentRuns.cancel")} onClick={() => cancel(run.id)} danger><CircleStop size={15} /></IconButton>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`${t("common.run")} ${shortId(selected)}`} icon={<ClipboardList size={18} />} actions={selectedRun && <span className={cliStatusClass[selectedRun.status]}>{statusLabel(t, selectedRun.status)}</span>}>
        {selectedRun ? (
          <div className="run-detail">
            <dl className="kv">
              <dt>{t("agentRuns.workspace")}</dt><dd>{selectedRun.effective_workspace || selectedRun.target_workspace}</dd>
              <dt>{t("table.provider")}</dt><dd>{selectedRun.provider} · {selectedMeta.mode || "-"}</dd>
              <dt>{t("agentRuns.parentSession")}</dt><dd>{selectedRun.parent_session_id || "-"}</dd>
              <dt>{t("agentRuns.parentTask")}</dt><dd>{selectedRun.parent_task_id || "-"}</dd>
              <dt>{t("agentRuns.providerReason")}</dt><dd>{selectedMeta.providerReason || "-"}</dd>
              <dt>{t("agentRuns.resultSummary")}</dt><dd>{asText(result.summary) || "-"}</dd>
              <dt>{t("agentRuns.blockers")}</dt><dd>{Array.isArray(result.blockers) && result.blockers.length ? (result.blockers as string[]).join("; ") : "-"}</dd>
              <dt>{t("agentRuns.tests")}</dt><dd>{asText(result.tests_run || selectedMeta.suggestedTests) || "-"}</dd>
              <dt>{t("agentRuns.changed")}</dt><dd>{t("common.filesCount", { count: changedCount(result) })}</dd>
              <dt>{t("agentRuns.error")}</dt><dd>{selectedRun.error || "-"}</dd>
              <dt>{t("agentRuns.policy")}</dt><dd>{asText(selectedRun.policy)}</dd>
            </dl>
            <pre className="log-box">{events.map((e) => `[${e.type}] ${asText(e.payload.text || e.payload.status || e.payload.error)}\n`).join("")}</pre>
            <pre className="log-box">{asText(result)}</pre>
            <pre className="log-box tall">{diff}</pre>
          </div>
        ) : <div className="empty">{t("agentRuns.selectRun")}</div>}
      </Section>
    </div>
  );
}
