import {
  Activity,
  Bot,
  Boxes,
  CalendarClock,
  Check,
  ChevronRight,
  CircleStop,
  ClipboardList,
  Code2,
  Database,
  FileText,
  FolderOpen,
  Globe2,
  HardDrive,
  KeyRound,
  Languages,
  ListTree,
  Loader2,
  LogOut,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  ServerCog,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, login } from "./api";
import type { PageKey, Status, CliRunStatus, Lang, Session, Message, Task, WorkerInfo, StatusInfo, TaskEvent, LlmConfig, Schedule, FileItem, BrowserTab, CliTool, CliEnvProfile, CliProviderProfile, CliRun, CliRunEvent } from "./lib/types";
import { I18N, makeT, getInitialLang } from "./lib/i18n";
import type { I18nKey, T } from "./lib/i18n";
import { fmtTime, shortId, asText, changedCount, blockersCount, orchestrationMeta, statusLabel, toolStatusLabel, policyLabel, statusClass, cliStatusClass } from "./lib/utils";

const navItems: Array<{ key: PageKey; labelKey: I18nKey; icon: ReactNode }> = [
  { key: "chat", labelKey: "nav.chat", icon: <MessageSquare size={17} /> },
  { key: "workers", labelKey: "nav.workers", icon: <Boxes size={17} /> },
  { key: "queue", labelKey: "nav.queue", icon: <ClipboardList size={17} /> },
  { key: "cliTools", labelKey: "nav.cliTools", icon: <Code2 size={17} /> },
  { key: "agentRuns", labelKey: "nav.agentRuns", icon: <Activity size={17} /> },
  { key: "config", labelKey: "nav.config", icon: <Settings2 size={17} /> },
  { key: "schedules", labelKey: "nav.schedules", icon: <CalendarClock size={17} /> },
  { key: "memory", labelKey: "nav.memory", icon: <Database size={17} /> },
  { key: "files", labelKey: "nav.files", icon: <FolderOpen size={17} /> },
  { key: "browser", labelKey: "nav.browser", icon: <Globe2 size={17} /> },
  { key: "logs", labelKey: "nav.logs", icon: <ServerCog size={17} /> }
];

function IconButton({
  title,
  onClick,
  children,
  danger,
  disabled
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`icon-btn ${danger ? "danger" : ""}`} type="button" title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Section({ title, icon, actions, children }: { title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>
          {icon}
          {title}
        </h2>
        <div className="actions">{actions}</div>
      </div>
      {children}
    </section>
  );
}

function useAsyncData<T>(token: string, path: string, fallback: T, interval = 0) {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api<T>(path, token));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [path, token]);

  useEffect(() => {
    refresh();
    if (!interval) return;
    const timer = window.setInterval(refresh, interval);
    return () => window.clearInterval(timer);
  }, [refresh, interval]);

  return { data, setData, error, refresh };
}

function Login({ onLogin, t }: { onLogin: (token: string) => void; t: T }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = await login(password);
      localStorage.setItem("ga_token", token);
      onLogin(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">
          <Bot size={28} />
        </div>
        <h1>GenericAgent Web</h1>
        <label>
          <span>{t("auth.password")}</span>
          <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-btn" type="submit" disabled={busy || !password}>
          {busy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
          {t("auth.login")}
        </button>
      </form>
    </main>
  );
}

function ChatPage({ token, t, onOpenRun }: { token: string; t: T; onOpenRun: (runId: string) => void }) {
  const sessions = useAsyncData<Session[]>(token, "/api/sessions", [], 3000);
  const tasks = useAsyncData<Task[]>(token, "/api/tasks", [], 2000);
  const [active, setActive] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [childRuns, setChildRuns] = useState<CliRun[]>([]);
  const [watchTask, setWatchTask] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active && sessions.data.length) setActive(sessions.data[0].id);
  }, [active, sessions.data]);

  const loadMessages = useCallback(async () => {
    if (!active) return;
    setMessages(await api<Message[]>(`/api/sessions/${active}/messages`, token));
  }, [active, token]);

  useEffect(() => {
    loadMessages().catch((err) => setError(err.message));
  }, [loadMessages]);

  useEffect(() => {
    if (!active) return;
    let canceled = false;
    async function loadChildRuns() {
      try {
        const data = await api<{ items: CliRun[] }>(`/api/sessions/${active}/cli-runs`, token);
        if (!canceled) setChildRuns(data.items);
      } catch {
        if (!canceled) setChildRuns([]);
      }
    }
    loadChildRuns();
    const timer = window.setInterval(loadChildRuns, 2500);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [active, token]);

  useEffect(() => {
    if (!watchTask) return;
    let canceled = false;
    let seq = 0;
    async function poll() {
      try {
        const data = await api<{ events: TaskEvent[] }>(`/api/tasks/${watchTask}/events?after_seq=${seq}`, token);
        if (canceled) return;
        if (data.events.length) {
          seq = Math.max(...data.events.map((item) => item.seq));
          setEvents((prev) => [...prev, ...data.events]);
          if (data.events.some((item) => item.type === "done" || item.type === "error")) loadMessages().catch(() => undefined);
        }
      } catch {
        return;
      }
    }
    poll();
    const timer = window.setInterval(poll, 900);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [loadMessages, token, watchTask]);

  async function newSession() {
    const session = await api<Session>("/api/sessions", token, {
      method: "POST",
      body: JSON.stringify({ title: t("chat.newSessionTitle") })
    });
    setActive(session.id);
    await sessions.refresh();
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, session_id: active, role: "user", content, created_at: Date.now() / 1000 }
    ]);
    try {
      const data = await api<{ task_id: string; queue_position: number }>(`/api/sessions/${active}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ content })
      });
      setWatchTask(data.task_id);
      setEvents([]);
      await tasks.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelTask(taskId: string) {
    await api(`/api/tasks/${taskId}/cancel`, token, { method: "POST" });
    await tasks.refresh();
  }

  const activeTasks = tasks.data.filter((task) => task.session_id === active && ["pending", "leased", "running"].includes(task.status));

  return (
    <div className="chat-grid">
      <aside className="list-pane">
        <div className="pane-head">
          <span>{t("chat.sessions")}</span>
          <IconButton title={t("chat.newSession")} onClick={newSession}>
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="session-list">
          {sessions.data.map((session) => (
            <button className={`session-item ${active === session.id ? "active" : ""}`} key={session.id} onClick={() => setActive(session.id)}>
              <span>{session.title}</span>
              <small>{fmtTime(session.updated_at)}</small>
            </button>
          ))}
        </div>
      </aside>
      <section className="chat-main">
        <div className="chat-head">
          <div>
            <h2>{sessions.data.find((item) => item.id === active)?.title || t("chat.title")}</h2>
            <span>{activeTasks.length ? t("chat.activeTasks", { count: activeTasks.length }) : t("common.idle")}</span>
          </div>
          <div className="task-pills">
            {activeTasks.map((task) => (
              <button className={statusClass[task.status]} key={task.id} onClick={() => setWatchTask(task.id)}>
                {shortId(task.id)} · {statusLabel(t, task.status)}
              </button>
            ))}
          </div>
        </div>
        {childRuns.length > 0 && (
          <div className="child-run-strip">
            {childRuns.slice(0, 6).map((run) => (
              <article className="child-run-card" key={run.id}>
                <div className="child-run-main">
                  <strong>{run.provider} · {orchestrationMeta(run).mode || "-"}</strong>
                  <span>{shortId(run.id)} · {run.workspace_mode || "-"} · {t("common.filesCount", { count: changedCount(run.result) })}</span>
                  {orchestrationMeta(run).providerReason && <small>{orchestrationMeta(run).providerReason}</small>}
                </div>
                <span className={cliStatusClass[run.status]}>{statusLabel(t, run.status)}</span>
                <button className="link-btn" type="button" title={t("chat.viewRun", { id: shortId(run.id) })} onClick={() => onOpenRun(run.id)}>
                  {t("common.viewResult")} · {t("agentRuns.blockers")} {blockersCount(run.result)}
                </button>
              </article>
            ))}
          </div>
        )}
        {error && <div className="inline-error">{error}</div>}
        <div className="messages">
          {messages.map((message) => (
            <article className={`message ${message.role === "user" ? "user" : "agent"}`} key={message.id}>
              <div className="role">{message.role === "user" ? t("role.user") : t("role.agent")}</div>
              <pre>{message.content}</pre>
            </article>
          ))}
          {events.length > 0 && (
            <article className="message agent">
              <div className="role">{t("chat.task")} {shortId(watchTask)}</div>
              <pre>{events.map((event) => asText(event.payload.text || event.payload.error || event.type)).join("")}</pre>
            </article>
          )}
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="composer-actions">
            {activeTasks.map((task) => (
              <IconButton key={task.id} title={t("chat.cancelTask", { id: shortId(task.id) })} onClick={() => cancelTask(task.id)} danger>
                <CircleStop size={16} />
              </IconButton>
            ))}
            <button className="primary-btn" type="submit" disabled={!active || !draft.trim()}>
              <Send size={16} />
              {t("chat.send")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function WorkersPage({ token, t }: { token: string; t: T }) {
  const workers = useAsyncData<WorkerInfo[]>(token, "/api/workers", [], 2000);
  async function restart(workerId: string) {
    await api(`/api/workers/${workerId}/restart`, token, { method: "POST" });
    await workers.refresh();
  }
  return (
    <Section
      title={t("workers.title")}
      icon={<Boxes size={18} />}
      actions={
        <IconButton title={t("common.refresh")} onClick={workers.refresh}>
          <RefreshCw size={16} />
        </IconButton>
      }
    >
      <div className="worker-grid">
        {workers.data.map((worker) => (
          <article className="flat-card" key={worker.id}>
            <div className="card-row">
              <strong>{worker.id}</strong>
              <span className={worker.current_task_id ? "badge live" : worker.alive ? "badge ok" : "badge bad"}>
                {worker.current_task_id ? t("status.running") : worker.alive ? t("common.idle") : t("workers.dead")}
              </span>
            </div>
            <dl className="kv">
              <dt>{t("workers.ready")}</dt>
              <dd>{String(worker.ready)}</dd>
              <dt>{t("workers.task")}</dt>
              <dd>{shortId(worker.current_task_id)}</dd>
              <dt>{t("workers.lastError")}</dt>
              <dd>{worker.last_error || "-"}</dd>
            </dl>
            <IconButton title={t("workers.restart")} onClick={() => restart(worker.id)}>
              <RefreshCw size={16} />
            </IconButton>
          </article>
        ))}
        {!workers.data.length && <div className="empty">{t("workers.noWorkers")}</div>}
      </div>
    </Section>
  );
}

function QueuePage({ token, t }: { token: string; t: T }) {
  const tasks = useAsyncData<Task[]>(token, "/api/tasks", [], 1800);
  const grouped = useMemo(
    () => ({
      active: tasks.data.filter((task) => ["pending", "leased", "running"].includes(task.status)),
      history: tasks.data.filter((task) => !["pending", "leased", "running"].includes(task.status))
    }),
    [tasks.data]
  );

  async function cancel(taskId: string) {
    await api(`/api/tasks/${taskId}/cancel`, token, { method: "POST" });
    await tasks.refresh();
  }

  function table(items: Task[]) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("table.id")}</th>
              <th>{t("table.kind")}</th>
              <th>{t("table.session")}</th>
              <th>{t("table.status")}</th>
              <th>{t("table.worker")}</th>
              <th>{t("table.updated")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((task) => (
              <tr key={task.id}>
                <td>{shortId(task.id)}</td>
                <td>{task.kind}</td>
                <td>{shortId(task.session_id)}</td>
                <td>
                  <span className={statusClass[task.status]}>{statusLabel(t, task.status)}</span>
                </td>
                <td>{task.leased_by || "-"}</td>
                <td>{fmtTime(task.updated_at)}</td>
                <td>
                  {["pending", "leased", "running"].includes(task.status) && (
                    <IconButton title={t("common.cancel")} onClick={() => cancel(task.id)} danger>
                      <X size={15} />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <Section title={t("queue.active")} icon={<Activity size={18} />} actions={<IconButton title={t("common.refresh")} onClick={tasks.refresh}><RefreshCw size={16} /></IconButton>}>
        {table(grouped.active)}
      </Section>
      <Section title={t("queue.history")} icon={<ListTree size={18} />}>{table(grouped.history)}</Section>
    </>
  );
}

function CliToolsPage({ token, t }: { token: string; t: T }) {
  const tools = useAsyncData<{ items: CliTool[] }>(token, "/api/cli-tools", { items: [] }, 4000);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 4000);
  const providerProfiles = useAsyncData<{ items: CliProviderProfile[] }>(token, "/api/cli-provider-profiles", { items: [] }, 4000);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState({ name: "", tool_id: "codex" });
  const [envText, setEnvText] = useState('{\n  "OPENAI_API_KEY": ""\n}');
  const [notice, setNotice] = useState("");

  async function install(toolId: string) {
    setNotice(t("cliTools.installing", { id: toolId }));
    await api(`/api/cli-tools/${toolId}/install`, token, {
      method: "POST",
      body: JSON.stringify({ version: versions[toolId] || "latest" })
    });
    setNotice(t("cliTools.installed", { id: toolId }));
    await tools.refresh();
  }

  async function test(toolId: string) {
    const result = await api<Record<string, unknown>>(`/api/cli-tools/${toolId}/test`, token, { method: "POST" });
    setNotice(`${toolId}: ${asText(result.detected_version || result.stderr || result.stdout)}`);
    await tools.refresh();
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const env = JSON.parse(envText || "{}");
    await api("/api/cli-env-profiles", token, {
      method: "POST",
      body: JSON.stringify({ ...profile, env })
    });
    setProfile({ name: "", tool_id: "codex" });
    await profiles.refresh();
  }

  return (
    <div className="two-column wide-left">
      <Section
        title={t("cliTools.title")}
        icon={<Code2 size={18} />}
        actions={
          <>
            {notice && <span className="badge neutral">{notice}</span>}
            <IconButton title={t("common.refresh")} onClick={tools.refresh}>
              <RefreshCw size={16} />
            </IconButton>
          </>
        }
      >
        <div className="tool-grid">
          {tools.data.items.map((tool) => (
            <article className="flat-card" key={tool.id}>
              {(() => {
                const providerProfile = providerProfiles.data.items.find((item) => item.provider === tool.id);
                return (
                  <>
              <div className="card-row">
                <strong>{tool.name}</strong>
                <span className={tool.status === "installed" ? "badge ok" : tool.status === "broken" ? "badge bad" : "badge neutral"}>{toolStatusLabel(t, tool.status)}</span>
              </div>
              <dl className="kv">
                <dt>{t("cliTools.package")}</dt>
                <dd>{tool.package || "-"}</dd>
                <dt>{t("cliTools.version")}</dt>
                <dd>{tool.resolved_version || tool.requested_version || "-"}</dd>
                <dt>{t("cliTools.command")}</dt>
                <dd>{tool.command_path || tool.command || "-"}</dd>
                <dt>{t("cliTools.error")}</dt>
                <dd>{tool.error || "-"}</dd>
                <dt>{t("cliTools.strengths")}</dt>
                <dd>{providerProfile?.strengths?.join(", ") || "-"}</dd>
                <dt>{t("cliTools.recent")}</dt>
                <dd>{providerProfile ? `${providerProfile.recent_success}/${providerProfile.recent_failure}` : "-"}</dd>
                <dt>{t("cliTools.notes")}</dt>
                <dd>{providerProfile?.notes?.slice(-2).join("; ") || "-"}</dd>
              </dl>
              <div className="pathbar compact">
                <input
                  value={versions[tool.id] || "latest"}
                  onChange={(e) => setVersions({ ...versions, [tool.id]: e.target.value })}
                />
                <IconButton title={t("cliTools.install")} onClick={() => install(tool.id)} disabled={tool.install_kind === "custom"}>
                  <HardDrive size={16} />
                </IconButton>
                <IconButton title={t("cliTools.test")} onClick={() => test(tool.id)}>
                  <Play size={16} />
                </IconButton>
              </div>
                  </>
                );
              })()}
            </article>
          ))}
        </div>
      </Section>
      <Section title={t("cliTools.envProfiles")} icon={<KeyRound size={18} />} actions={<IconButton title={t("common.refresh")} onClick={profiles.refresh}><RefreshCw size={16} /></IconButton>}>
        <form className="inline-form" onSubmit={saveProfile}>
          <input placeholder={t("cliTools.profileName")} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          <select value={profile.tool_id} onChange={(e) => setProfile({ ...profile, tool_id: e.target.value })}>
            {tools.data.items.map((tool) => (
              <option value={tool.id} key={tool.id}>{tool.name}</option>
            ))}
          </select>
          <textarea className="code-editor small" value={envText} onChange={(e) => setEnvText(e.target.value)} />
          <button className="primary-btn" type="submit">
            <Save size={16} />
            {t("common.save")}
          </button>
        </form>
        <div className="row-list">
          {profiles.data.items.map((item) => (
            <div className="row-item" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.tool_id} · {Object.keys(item.env || {}).join(", ") || "-"}</span>
              </div>
              <small>{fmtTime(item.updated_at)}</small>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function AgentRunsPage({
  token,
  t,
  selectedRunId,
  onSelectedRun
}: {
  token: string;
  t: T;
  selectedRunId?: string;
  onSelectedRun?: (runId: string) => void;
}) {
  const runs = useAsyncData<{ items: CliRun[] }>(token, "/api/cli-runs", { items: [] }, 2500);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 5000);
  const [form, setForm] = useState({
    provider: "codex",
    mode: "implement",
    provider_reason: "",
    prompt: "",
    target_workspace: "/data/workspace",
    write_intent: true,
    allow_write: true,
    allow_tests: true,
    allow_install: false,
    allow_network: true,
    allow_commit: false,
    allow_push: false,
    env_profile_id: ""
  });
  const [selected, setSelectedState] = useState("");
  const [events, setEvents] = useState<CliRunEvent[]>([]);
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
      allow_write: form.allow_write,
      allow_tests: form.allow_tests,
      allow_install: form.allow_install,
      allow_network: form.allow_network,
      allow_commit: form.allow_commit,
      allow_push: form.allow_push,
      _orchestration: {
        mode: form.mode,
        provider_reason: form.provider_reason
      }
    };
    const run = await api<CliRun>("/api/cli-runs", token, {
      method: "POST",
      body: JSON.stringify({
        provider: form.provider,
        prompt: form.prompt,
        target_workspace: form.target_workspace,
        write_intent: form.write_intent,
        policy,
        env_profile_id: form.env_profile_id || null
      })
    });
    setSelected(run.id);
    setForm({ ...form, prompt: "" });
    await runs.refresh();
  }

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const [eventData, diffData, resultData] = await Promise.all([
      api<{ events: CliRunEvent[] }>(`/api/cli-runs/${selected}/events?limit=500`, token),
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
          <input value={form.target_workspace} onChange={(e) => setForm({ ...form, target_workspace: e.target.value })} />
          <select value={form.env_profile_id} onChange={(e) => setForm({ ...form, env_profile_id: e.target.value })}>
            <option value="">{t("agentRuns.noEnvProfile")}</option>
            {profiles.data.items.map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
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
          <button className="primary-btn" type="submit" disabled={!form.prompt.trim()}>
            <Play size={16} />
            {t("common.run")}
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("table.id")}</th>
                <th>{t("table.provider")}</th>
                <th>{t("table.status")}</th>
                <th>{t("table.mode")}</th>
                <th>{t("table.updated")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.data.items.map((run) => (
                <tr key={run.id} className={selected === run.id ? "selected-row" : ""}>
                  <td><button className="link-btn" type="button" onClick={() => setSelected(run.id)}>{shortId(run.id)}</button></td>
                  <td>{run.provider}</td>
                  <td><span className={cliStatusClass[run.status]}>{statusLabel(t, run.status)}</span></td>
                  <td>{orchestrationMeta(run).mode || run.workspace_mode || "-"}</td>
                  <td>{fmtTime(run.updated_at)}</td>
                  <td>
                    {["pending", "preparing", "running"].includes(run.status) && (
                      <IconButton title={t("agentRuns.cancel")} onClick={() => cancel(run.id)} danger>
                        <CircleStop size={15} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title={`${t("common.run")} ${shortId(selected)}`}
        icon={<ClipboardList size={18} />}
        actions={selectedRun && <span className={cliStatusClass[selectedRun.status]}>{statusLabel(t, selectedRun.status)}</span>}
      >
        {selectedRun ? (
          <div className="run-detail">
            <dl className="kv">
              <dt>{t("agentRuns.workspace")}</dt>
              <dd>{selectedRun.effective_workspace || selectedRun.target_workspace}</dd>
              <dt>{t("table.provider")}</dt>
              <dd>{selectedRun.provider} · {selectedMeta.mode || "-"}</dd>
              <dt>{t("agentRuns.parentSession")}</dt>
              <dd>{selectedRun.parent_session_id || "-"}</dd>
              <dt>{t("agentRuns.parentTask")}</dt>
              <dd>{selectedRun.parent_task_id || "-"}</dd>
              <dt>{t("agentRuns.providerReason")}</dt>
              <dd>{selectedMeta.providerReason || "-"}</dd>
              <dt>{t("agentRuns.resultSummary")}</dt>
              <dd>{asText(result.summary) || "-"}</dd>
              <dt>{t("agentRuns.blockers")}</dt>
              <dd>{Array.isArray(result.blockers) && result.blockers.length ? result.blockers.join("; ") : "-"}</dd>
              <dt>{t("agentRuns.tests")}</dt>
              <dd>{asText(result.tests_run || selectedMeta.suggestedTests) || "-"}</dd>
              <dt>{t("agentRuns.changed")}</dt>
              <dd>{t("common.filesCount", { count: changedCount(result) })}</dd>
              <dt>{t("agentRuns.error")}</dt>
              <dd>{selectedRun.error || "-"}</dd>
              <dt>{t("agentRuns.policy")}</dt>
              <dd>{asText(selectedRun.policy)}</dd>
            </dl>
            <pre className="log-box">{events.map((event) => `[${event.type}] ${asText(event.payload.text || event.payload.status || event.payload.error)}\n`).join("")}</pre>
            <pre className="log-box">{asText(result)}</pre>
            <pre className="log-box tall">{diff}</pre>
          </div>
        ) : (
          <div className="empty">{t("agentRuns.selectRun")}</div>
        )}
      </Section>
    </div>
  );
}

function ConfigPage({ token, t }: { token: string; t: T }) {
  const config = useAsyncData<LlmConfig>(token, "/api/config/llm", { configs: [], extras: {}, path: "" });
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setDraft(JSON.stringify(config.data.configs, null, 2));
  }, [config.data.configs]);

  async function save() {
    const configs = JSON.parse(draft || "[]");
    await api("/api/config/llm", token, {
      method: "PUT",
      body: JSON.stringify({ configs, extras: config.data.extras || {} })
    });
    await api("/api/runtime/reload", token, { method: "POST" });
    setNotice(t("config.saved"));
    await config.refresh();
  }

  return (
    <Section
      title={t("nav.config")}
      icon={<Settings2 size={18} />}
      actions={
        <>
          {notice && <span className="badge ok">{notice}</span>}
          <button className="primary-btn" type="button" onClick={save}>
            <Save size={16} />
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="split">
        <div className="flat-card">
          <dl className="kv">
            <dt>{t("config.path")}</dt>
            <dd>{config.data.path || "-"}</dd>
            <dt>{t("config.configs")}</dt>
            <dd>{config.data.configs.length}</dd>
          </dl>
          {config.data.configs.map((item) => (
            <div className="config-line" key={item.var}>
              <span>{item.var}</span>
              <small>{item.kind}</small>
              <code>{asText(item.data.model)}</code>
            </div>
          ))}
        </div>
        <textarea className="code-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
    </Section>
  );
}

function SchedulesPage({ token, t }: { token: string; t: T }) {
  const schedules = useAsyncData<{ items: Schedule[] }>(token, "/api/schedules", { items: [] }, 3000);
  const reports = useAsyncData<{ items: Array<Record<string, unknown>> }>(token, "/api/schedules/reports", { items: [] }, 3000);
  const [form, setForm] = useState({ title: "", prompt: "", cron: "@every 1h", enabled: true });

  async function create(event: FormEvent) {
    event.preventDefault();
    await api("/api/schedules", token, { method: "POST", body: JSON.stringify(form) });
    setForm({ title: "", prompt: "", cron: "@every 1h", enabled: true });
    await schedules.refresh();
  }

  async function enqueue(id: string) {
    await api(`/api/schedules/${id}/enqueue`, token, { method: "POST" });
    await reports.refresh();
  }

  async function remove(id: string) {
    await api(`/api/schedules/${id}`, token, { method: "DELETE" });
    await schedules.refresh();
  }

  return (
    <div className="two-column">
      <Section title={t("nav.schedules")} icon={<CalendarClock size={18} />}>
        <form className="inline-form" onSubmit={create}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} />
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <label className="checkline">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t("schedules.enabled")}
          </label>
          <button className="primary-btn" type="submit">
            <Plus size={16} />
            {t("common.create")}
          </button>
        </form>
        <div className="row-list">
          {schedules.data.items.map((item) => (
            <div className="row-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.cron} · {t("schedules.next")} {fmtTime(item.next_run_at)}</span>
              </div>
              <IconButton title={t("schedules.enqueue")} onClick={() => enqueue(item.id)}>
                <Play size={15} />
              </IconButton>
              <IconButton title={t("common.delete")} onClick={() => remove(item.id)} danger>
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t("schedules.reports")} icon={<ClipboardList size={18} />}>
        <pre className="log-box">{JSON.stringify(reports.data.items, null, 2)}</pre>
      </Section>
    </div>
  );
}

function MemoryPage({ token, t }: { token: string; t: T }) {
  const [path, setPath] = useState("global_mem_insight.txt");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const data = await api<{ content: string }>(`/api/memory/files/${encodeURIComponent(path).replace(/%2F/g, "/")}`, token);
    setContent(data.content);
  }

  async function save() {
    await api(`/api/memory/files/${encodeURIComponent(path).replace(/%2F/g, "/")}`, token, {
      method: "PUT",
      body: JSON.stringify({ content })
    });
    setNotice(t("config.saved"));
  }

  return (
    <Section title={t("nav.memory")} icon={<Database size={18} />} actions={<button className="primary-btn" type="button" onClick={save}><Save size={16} />{t("common.save")}</button>}>
      <div className="pathbar">
        <input value={path} onChange={(e) => setPath(e.target.value)} />
        <IconButton title={t("memory.load")} onClick={load}>
          <RefreshCw size={16} />
        </IconButton>
        {notice && <span className="badge ok">{notice}</span>}
      </div>
      <textarea className="large-editor" value={content} onChange={(e) => setContent(e.target.value)} />
    </Section>
  );
}

function FilesPage({ token, t }: { token: string; t: T }) {
  const [root, setRoot] = useState("workspace");
  const [path, setPath] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [content, setContent] = useState("");

  async function browse(nextPath = path) {
    const data = await api<{ items?: FileItem[]; content?: string }>(
      `/api/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent(nextPath)}${nextPath && !nextPath.includes(".") ? "" : "&read=true"}`,
      token
    );
    if (data.items) setItems(data.items);
    if (data.content != null) setContent(data.content);
    setPath(nextPath);
  }

  async function save() {
    await api("/api/files", token, { method: "PUT", body: JSON.stringify({ root, path, content }) });
    await browse(path);
  }

  return (
    <div className="two-column wide-left">
      <Section title={t("nav.files")} icon={<FolderOpen size={18} />}>
        <div className="pathbar">
          <select value={root} onChange={(e) => setRoot(e.target.value)}>
            <option value="workspace">{t("root.workspace")}</option>
            <option value="temp">{t("root.temp")}</option>
            <option value="memory">{t("root.memory")}</option>
          </select>
          <input value={path} onChange={(e) => setPath(e.target.value)} />
          <IconButton title={t("common.open")} onClick={() => browse(path)}>
            <ChevronRight size={16} />
          </IconButton>
        </div>
        <div className="row-list">
          {items.map((item) => (
            <button className="row-item file" key={item.path} onClick={() => browse(item.path)}>
              <span>{item.is_dir ? <FolderOpen size={15} /> : <FileText size={15} />}</span>
              <strong>{item.name}</strong>
              <small>{item.size} B</small>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("files.editor")} icon={<Code2 size={18} />} actions={<button className="primary-btn" type="button" onClick={save}><Save size={16} />{t("common.save")}</button>}>
        <textarea className="large-editor" value={content} onChange={(e) => setContent(e.target.value)} />
      </Section>
    </div>
  );
}

function BrowserPage({ token, t }: { token: string; t: T }) {
  const [workerId, setWorkerId] = useState("worker-1");
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTab, setActiveTab] = useState("p1");
  const [url, setUrl] = useState("https://example.com");
  const [code, setCode] = useState("return document.title;");
  const [result, setResult] = useState("");
  const [screenshot, setScreenshot] = useState("");

  async function loadTabs() {
    const data = await api<{ items: BrowserTab[] }>(`/api/browser/workers/${workerId}/tabs`, token);
    setTabs(data.items);
    if (data.items[0]) setActiveTab(data.items[0].id);
  }

  async function newTab() {
    await api(`/api/browser/workers/${workerId}/tabs`, token, { method: "POST", body: JSON.stringify({ url }) });
    await loadTabs();
  }

  async function navigate() {
    await api(`/api/browser/workers/${workerId}/tabs/${activeTab}/navigate`, token, { method: "POST", body: JSON.stringify({ url }) });
    await loadTabs();
  }

  async function execute() {
    const data = await api<Record<string, unknown>>(`/api/browser/workers/${workerId}/tabs/${activeTab}/execute`, token, {
      method: "POST",
      body: JSON.stringify({ code })
    });
    setResult(JSON.stringify(data, null, 2));
  }

  async function capture() {
    const data = await api<{ base64: string }>(`/api/browser/workers/${workerId}/tabs/${activeTab}/screenshot`, token);
    setScreenshot(data.base64);
  }

  useEffect(() => {
    loadTabs().catch(() => undefined);
  }, [workerId]);

  return (
    <div className="two-column">
      <Section title={t("nav.browser")} icon={<Globe2 size={18} />}>
        <div className="cloud-note">{t("browser.note")}</div>
        <div className="pathbar">
          <input value={workerId} onChange={(e) => setWorkerId(e.target.value)} />
          <IconButton title={t("browser.refreshTabs")} onClick={loadTabs}>
            <RefreshCw size={16} />
          </IconButton>
        </div>
        <div className="pathbar">
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
          <IconButton title={t("browser.newTab")} onClick={newTab}>
            <Plus size={16} />
          </IconButton>
          <IconButton title={t("browser.navigate")} onClick={navigate}>
            <Play size={16} />
          </IconButton>
        </div>
        <div className="row-list">
          {tabs.map((tab) => (
            <button className={`row-item file ${tab.id === activeTab ? "active" : ""}`} key={tab.id} onClick={() => setActiveTab(tab.id)}>
              <strong>{tab.id}</strong>
              <span>{tab.title || tab.url}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section
        title={t("common.execute")}
        icon={<Code2 size={18} />}
        actions={
          <>
            <IconButton title={t("browser.screenshot")} onClick={capture}>
              <HardDrive size={16} />
            </IconButton>
            <button className="primary-btn" type="button" onClick={execute}>
              <Play size={16} />
              {t("common.execute")}
            </button>
          </>
        }
      >
        <textarea className="code-editor small" value={code} onChange={(e) => setCode(e.target.value)} />
        <pre className="log-box">{result}</pre>
        {screenshot && <img className="screenshot" src={`data:image/png;base64,${screenshot}`} alt="" />}
      </Section>
    </div>
  );
}

function LogsPage({ token, status, t }: { token: string; status?: StatusInfo; t: T }) {
  const [kind, setKind] = useState("server");
  const [content, setContent] = useState("");

  async function load() {
    const data = await api<{ content: string }>(`/api/logs?kind=${encodeURIComponent(kind)}&lines=300`, token);
    setContent(data.content);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [kind]);

  return (
    <div className="two-column">
      <Section title={t("logs.system")} icon={<ServerCog size={18} />}>
        <dl className="kv">
          <dt>{t("logs.dataDir")}</dt>
          <dd>{status?.data_dir || "-"}</dd>
          <dt>{t("logs.configured")}</dt>
          <dd>{String(status?.configured ?? false)}</dd>
          <dt>{t("logs.concurrency")}</dt>
          <dd>{status?.worker_concurrency ?? "-"}</dd>
          <dt>{t("logs.cliRunners")}</dt>
          <dd>{status?.cli_runner_concurrency ?? "-"}</dd>
          <dt>{t("logs.activeCliRuns")}</dt>
          <dd>{status?.active_cli_runs ?? "-"}</dd>
        </dl>
      </Section>
      <Section title={t("logs.logs")} icon={<FileText size={18} />} actions={<IconButton title={t("common.refresh")} onClick={load}><RefreshCw size={16} /></IconButton>}>
        <div className="pathbar">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="server">{t("logKind.server")}</option>
            <option value="worker">{t("logKind.worker")}</option>
            <option value="scheduler">{t("logKind.scheduler")}</option>
            <option value="agent">{t("logKind.agent")}</option>
            <option value="browser">{t("logKind.browser")}</option>
          </select>
        </div>
        <pre className="log-box tall">{content}</pre>
      </Section>
    </div>
  );
}

import { AppShell } from "./components/layout/AppShell";

function AppShellWrapper({
  token,
  setToken,
  lang,
  setLang,
  t
}: {
  token: string;
  setToken: (token: string) => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: T;
}) {
  const [page, setPage] = useState<PageKey>("chat");
  const [selectedCliRun, setSelectedCliRun] = useState("");
  const status = useAsyncData<StatusInfo | undefined>(token, "/api/status", undefined, 5000);
  const workers = useAsyncData<WorkerInfo[]>(token, "/api/workers", [], 5000);
  const tasks = useAsyncData<Task[]>(token, "/api/tasks", [], 4000);
  const activeTasks = tasks.data.filter((task) => ["pending", "leased", "running"].includes(task.status));

  function logout() {
    localStorage.removeItem("ga_token");
    setToken("");
  }

  const content = {
    chat: <ChatPage token={token} t={t} onOpenRun={(runId) => { setSelectedCliRun(runId); setPage("agentRuns"); }} />,
    workers: <WorkersPage token={token} t={t} />,
    queue: <QueuePage token={token} t={t} />,
    cliTools: <CliToolsPage token={token} t={t} />,
    agentRuns: <AgentRunsPage token={token} t={t} selectedRunId={selectedCliRun} onSelectedRun={setSelectedCliRun} />,
    config: <ConfigPage token={token} t={t} />,
    schedules: <SchedulesPage token={token} t={t} />,
    memory: <MemoryPage token={token} t={t} />,
    files: <FilesPage token={token} t={t} />,
    browser: <BrowserPage token={token} t={t} />,
    logs: <LogsPage token={token} status={status.data} t={t} />
  }[page];

  return (
    <AppShell
      t={t} lang={lang} setLang={setLang}
      page={page} setPage={setPage} onLogout={logout}
      workers={workers.data} activeTasks={activeTasks} status={status.data}
    >
      {content}
      {(status.error || workers.error || tasks.error) && (
        <div className="toast">{status.error || workers.error || tasks.error}</div>
      )}
    </AppShell>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("ga_token") || "");
  const [lang, setLangState] = useState<Lang>(getInitialLang);
  const t = useMemo(() => makeT(lang), [lang]);

  function setLang(lang: Lang) {
    localStorage.setItem("ga_lang", lang);
    setLangState(lang);
  }

  useEffect(() => {
    if (!token) return;
    api("/api/auth/me", token).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem("ga_token");
        setToken("");
      }
    });
  }, [token]);

  return token ? <AppShellWrapper token={token} setToken={setToken} lang={lang} setLang={setLang} t={t} /> : <Login onLogin={setToken} t={t} />;
}
