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

type PageKey = "chat" | "workers" | "queue" | "cliTools" | "agentRuns" | "config" | "schedules" | "memory" | "files" | "browser" | "logs";
type Status = "pending" | "leased" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
type CliRunStatus = "pending" | "preparing" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

type Session = { id: string; title: string; updated_at: number; created_at: number };
type Message = { id: string; session_id: string; role: string; content: string; task_id?: string; created_at: number };
type Task = {
  id: string;
  kind: string;
  session_id: string;
  status: Status;
  payload: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  started_at?: number;
  finished_at?: number;
  leased_by?: string;
  error?: string;
  cancel_requested?: boolean;
};
type WorkerInfo = { id: string; ready: boolean; current_task_id?: string; last_error?: string; alive: boolean };
type StatusInfo = { data_dir: string; configured: boolean; worker_concurrency: number; cli_runner_concurrency?: number };
type TaskEvent = { seq: number; type: string; payload: Record<string, unknown>; created_at: number };
type LlmConfig = { configs: Array<{ var: string; kind: string; data: Record<string, unknown> }>; extras: Record<string, unknown>; path: string };
type Schedule = {
  id: string;
  title: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  next_run_at?: number | null;
  last_task_id?: string | null;
};
type FileItem = { name: string; path: string; is_dir: boolean; size: number; updated_at: number };
type BrowserTab = { id: string; url: string; title: string; type: string };
type CliTool = {
  id: string;
  name: string;
  provider: string;
  install_kind: string;
  package: string;
  command: string;
  status: string;
  requested_version: string;
  resolved_version: string;
  install_path: string;
  command_path: string;
  error: string;
};
type CliEnvProfile = { id: string; name: string; tool_id: string; env: Record<string, string>; created_at: number; updated_at: number };
type CliRun = {
  id: string;
  parent_task_id?: string;
  parent_session_id?: string;
  provider: string;
  target_workspace: string;
  effective_workspace: string;
  workspace_mode: string;
  prompt: string;
  status: CliRunStatus;
  policy: Record<string, unknown>;
  env_profile_id?: string;
  result: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  error?: string;
  cancel_requested?: boolean;
};
type CliRunEvent = { seq: number; type: string; payload: Record<string, unknown>; created_at: number };

const navItems: Array<{ key: PageKey; label: string; icon: ReactNode }> = [
  { key: "chat", label: "Chat", icon: <MessageSquare size={17} /> },
  { key: "workers", label: "Workers", icon: <Boxes size={17} /> },
  { key: "queue", label: "Queue", icon: <ClipboardList size={17} /> },
  { key: "cliTools", label: "CLI Tools", icon: <Code2 size={17} /> },
  { key: "agentRuns", label: "Agent Runs", icon: <Activity size={17} /> },
  { key: "config", label: "API 配置", icon: <Settings2 size={17} /> },
  { key: "schedules", label: "Schedules", icon: <CalendarClock size={17} /> },
  { key: "memory", label: "Memory", icon: <Database size={17} /> },
  { key: "files", label: "Files", icon: <FolderOpen size={17} /> },
  { key: "browser", label: "Browser", icon: <Globe2 size={17} /> },
  { key: "logs", label: "Logs/System", icon: <ServerCog size={17} /> }
];

const statusClass: Record<Status, string> = {
  pending: "badge neutral",
  leased: "badge warn",
  running: "badge live",
  succeeded: "badge ok",
  failed: "badge bad",
  canceled: "badge muted",
  interrupted: "badge warn"
};
const cliStatusClass: Record<CliRunStatus, string> = {
  pending: "badge neutral",
  preparing: "badge warn",
  running: "badge live",
  succeeded: "badge ok",
  failed: "badge bad",
  canceled: "badge muted",
  interrupted: "badge warn"
};

function fmtTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function shortId(id?: string) {
  return id ? id.slice(0, 8) : "-";
}

function asText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function changedCount(result: Record<string, unknown>) {
  const files = result?.changed_files;
  return Array.isArray(files) ? files.length : 0;
}

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

function Login({ onLogin }: { onLogin: (token: string) => void }) {
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
          <span>管理密码</span>
          <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-btn" type="submit" disabled={busy || !password}>
          {busy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
          登录
        </button>
      </form>
    </main>
  );
}

function ChatPage({ token }: { token: string }) {
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
      body: JSON.stringify({ title: "New session" })
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
          <span>会话</span>
          <IconButton title="新建会话" onClick={newSession}>
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
            <h2>{sessions.data.find((item) => item.id === active)?.title || "Chat"}</h2>
            <span>{activeTasks.length ? `${activeTasks.length} 个任务在队列中` : "idle"}</span>
          </div>
          <div className="task-pills">
            {activeTasks.map((task) => (
              <button className={statusClass[task.status]} key={task.id} onClick={() => setWatchTask(task.id)}>
                {shortId(task.id)} · {task.status}
              </button>
            ))}
          </div>
        </div>
        {childRuns.length > 0 && (
          <div className="child-run-strip">
            {childRuns.slice(0, 6).map((run) => (
              <article className="child-run-card" key={run.id}>
                <div>
                  <strong>{run.provider}</strong>
                  <span>{shortId(run.id)} · {run.workspace_mode || "-"}</span>
                </div>
                <span className={cliStatusClass[run.status]}>{run.status}</span>
                <small>{changedCount(run.result) ? `${changedCount(run.result)} files` : fmtTime(run.updated_at)}</small>
              </article>
            ))}
          </div>
        )}
        {error && <div className="inline-error">{error}</div>}
        <div className="messages">
          {messages.map((message) => (
            <article className={`message ${message.role === "user" ? "user" : "agent"}`} key={message.id}>
              <div className="role">{message.role === "user" ? "User" : "Agent"}</div>
              <pre>{message.content}</pre>
            </article>
          ))}
          {events.length > 0 && (
            <article className="message agent">
              <div className="role">Task {shortId(watchTask)}</div>
              <pre>{events.map((event) => asText(event.payload.text || event.payload.error || event.type)).join("")}</pre>
            </article>
          )}
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="composer-actions">
            {activeTasks.map((task) => (
              <IconButton key={task.id} title={`取消 ${shortId(task.id)}`} onClick={() => cancelTask(task.id)} danger>
                <CircleStop size={16} />
              </IconButton>
            ))}
            <button className="primary-btn" type="submit" disabled={!active || !draft.trim()}>
              <Send size={16} />
              发送
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function WorkersPage({ token }: { token: string }) {
  const workers = useAsyncData<WorkerInfo[]>(token, "/api/workers", [], 2000);
  async function restart(workerId: string) {
    await api(`/api/workers/${workerId}/restart`, token, { method: "POST" });
    await workers.refresh();
  }
  return (
    <Section
      title="Workers"
      icon={<Boxes size={18} />}
      actions={
        <IconButton title="刷新" onClick={workers.refresh}>
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
                {worker.current_task_id ? "running" : worker.alive ? "idle" : "dead"}
              </span>
            </div>
            <dl className="kv">
              <dt>ready</dt>
              <dd>{String(worker.ready)}</dd>
              <dt>task</dt>
              <dd>{shortId(worker.current_task_id)}</dd>
              <dt>last error</dt>
              <dd>{worker.last_error || "-"}</dd>
            </dl>
            <IconButton title="重启 worker" onClick={() => restart(worker.id)}>
              <RefreshCw size={16} />
            </IconButton>
          </article>
        ))}
        {!workers.data.length && <div className="empty">No workers</div>}
      </div>
    </Section>
  );
}

function QueuePage({ token }: { token: string }) {
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
              <th>ID</th>
              <th>Kind</th>
              <th>Session</th>
              <th>Status</th>
              <th>Worker</th>
              <th>Updated</th>
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
                  <span className={statusClass[task.status]}>{task.status}</span>
                </td>
                <td>{task.leased_by || "-"}</td>
                <td>{fmtTime(task.updated_at)}</td>
                <td>
                  {["pending", "leased", "running"].includes(task.status) && (
                    <IconButton title="取消任务" onClick={() => cancel(task.id)} danger>
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
      <Section title="Active Queue" icon={<Activity size={18} />} actions={<IconButton title="刷新" onClick={tasks.refresh}><RefreshCw size={16} /></IconButton>}>
        {table(grouped.active)}
      </Section>
      <Section title="History" icon={<ListTree size={18} />}>{table(grouped.history)}</Section>
    </>
  );
}

function CliToolsPage({ token }: { token: string }) {
  const tools = useAsyncData<{ items: CliTool[] }>(token, "/api/cli-tools", { items: [] }, 4000);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 4000);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState({ name: "", tool_id: "codex" });
  const [envText, setEnvText] = useState('{\n  "OPENAI_API_KEY": ""\n}');
  const [notice, setNotice] = useState("");

  async function install(toolId: string) {
    setNotice(`installing ${toolId}`);
    await api(`/api/cli-tools/${toolId}/install`, token, {
      method: "POST",
      body: JSON.stringify({ version: versions[toolId] || "latest" })
    });
    setNotice(`installed ${toolId}`);
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
        title="CLI Tools"
        icon={<Code2 size={18} />}
        actions={
          <>
            {notice && <span className="badge neutral">{notice}</span>}
            <IconButton title="刷新" onClick={tools.refresh}>
              <RefreshCw size={16} />
            </IconButton>
          </>
        }
      >
        <div className="tool-grid">
          {tools.data.items.map((tool) => (
            <article className="flat-card" key={tool.id}>
              <div className="card-row">
                <strong>{tool.name}</strong>
                <span className={tool.status === "installed" ? "badge ok" : tool.status === "broken" ? "badge bad" : "badge neutral"}>{tool.status}</span>
              </div>
              <dl className="kv">
                <dt>package</dt>
                <dd>{tool.package || "-"}</dd>
                <dt>version</dt>
                <dd>{tool.resolved_version || tool.requested_version || "-"}</dd>
                <dt>command</dt>
                <dd>{tool.command_path || tool.command || "-"}</dd>
                <dt>error</dt>
                <dd>{tool.error || "-"}</dd>
              </dl>
              <div className="pathbar compact">
                <input
                  value={versions[tool.id] || "latest"}
                  onChange={(e) => setVersions({ ...versions, [tool.id]: e.target.value })}
                />
                <IconButton title="安装" onClick={() => install(tool.id)} disabled={tool.install_kind === "custom"}>
                  <HardDrive size={16} />
                </IconButton>
                <IconButton title="测试" onClick={() => test(tool.id)}>
                  <Play size={16} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      </Section>
      <Section title="Env Profiles" icon={<KeyRound size={18} />} actions={<IconButton title="刷新" onClick={profiles.refresh}><RefreshCw size={16} /></IconButton>}>
        <form className="inline-form" onSubmit={saveProfile}>
          <input placeholder="profile name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          <select value={profile.tool_id} onChange={(e) => setProfile({ ...profile, tool_id: e.target.value })}>
            {tools.data.items.map((tool) => (
              <option value={tool.id} key={tool.id}>{tool.name}</option>
            ))}
          </select>
          <textarea className="code-editor small" value={envText} onChange={(e) => setEnvText(e.target.value)} />
          <button className="primary-btn" type="submit">
            <Save size={16} />
            保存
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

function AgentRunsPage({ token }: { token: string }) {
  const runs = useAsyncData<{ items: CliRun[] }>(token, "/api/cli-runs", { items: [] }, 2500);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 5000);
  const [form, setForm] = useState({
    provider: "codex",
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
  const [selected, setSelected] = useState("");
  const [events, setEvents] = useState<CliRunEvent[]>([]);
  const [diff, setDiff] = useState("");
  const [result, setResult] = useState<Record<string, unknown>>({});
  const selectedRun = runs.data.items.find((item) => item.id === selected);

  async function createRun(event: FormEvent) {
    event.preventDefault();
    const policy = {
      allow_write: form.allow_write,
      allow_tests: form.allow_tests,
      allow_install: form.allow_install,
      allow_network: form.allow_network,
      allow_commit: form.allow_commit,
      allow_push: form.allow_push
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
      <Section title="Create Run" icon={<Code2 size={18} />} actions={<IconButton title="刷新" onClick={runs.refresh}><RefreshCw size={16} /></IconButton>}>
        <form className="inline-form run-form" onSubmit={createRun}>
          <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="codex">Codex</option>
            <option value="claude_code">Claude Code</option>
            <option value="opencode">OpenCode</option>
            <option value="custom_shell">Custom Shell</option>
          </select>
          <input value={form.target_workspace} onChange={(e) => setForm({ ...form, target_workspace: e.target.value })} />
          <select value={form.env_profile_id} onChange={(e) => setForm({ ...form, env_profile_id: e.target.value })}>
            <option value="">no env profile</option>
            {profiles.data.items.map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
          </select>
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <div className="toggle-grid">
            {(["write_intent", "allow_write", "allow_tests", "allow_install", "allow_network", "allow_commit", "allow_push"] as const).map((key) => (
              <label className="checkline" key={key}>
                <input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                {key}
              </label>
            ))}
          </div>
          <button className="primary-btn" type="submit" disabled={!form.prompt.trim()}>
            <Play size={16} />
            Run
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.data.items.map((run) => (
                <tr key={run.id} className={selected === run.id ? "selected-row" : ""}>
                  <td><button className="link-btn" type="button" onClick={() => setSelected(run.id)}>{shortId(run.id)}</button></td>
                  <td>{run.provider}</td>
                  <td><span className={cliStatusClass[run.status]}>{run.status}</span></td>
                  <td>{run.workspace_mode || "-"}</td>
                  <td>{fmtTime(run.updated_at)}</td>
                  <td>
                    {["pending", "preparing", "running"].includes(run.status) && (
                      <IconButton title="取消 run" onClick={() => cancel(run.id)} danger>
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
        title={`Run ${shortId(selected)}`}
        icon={<ClipboardList size={18} />}
        actions={selectedRun && <span className={cliStatusClass[selectedRun.status]}>{selectedRun.status}</span>}
      >
        {selectedRun ? (
          <div className="run-detail">
            <dl className="kv">
              <dt>workspace</dt>
              <dd>{selectedRun.effective_workspace || selectedRun.target_workspace}</dd>
              <dt>changed</dt>
              <dd>{changedCount(result)} files</dd>
              <dt>error</dt>
              <dd>{selectedRun.error || "-"}</dd>
            </dl>
            <pre className="log-box">{events.map((event) => `[${event.type}] ${asText(event.payload.text || event.payload.status || event.payload.error)}\n`).join("")}</pre>
            <pre className="log-box">{asText(result)}</pre>
            <pre className="log-box tall">{diff}</pre>
          </div>
        ) : (
          <div className="empty">Select a run</div>
        )}
      </Section>
    </div>
  );
}

function ConfigPage({ token }: { token: string }) {
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
    setNotice("saved");
    await config.refresh();
  }

  return (
    <Section
      title="API 配置"
      icon={<Settings2 size={18} />}
      actions={
        <>
          {notice && <span className="badge ok">{notice}</span>}
          <button className="primary-btn" type="button" onClick={save}>
            <Save size={16} />
            保存
          </button>
        </>
      }
    >
      <div className="split">
        <div className="flat-card">
          <dl className="kv">
            <dt>path</dt>
            <dd>{config.data.path || "-"}</dd>
            <dt>configs</dt>
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

function SchedulesPage({ token }: { token: string }) {
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
      <Section title="Schedules" icon={<CalendarClock size={18} />}>
        <form className="inline-form" onSubmit={create}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} />
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <label className="checkline">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            enabled
          </label>
          <button className="primary-btn" type="submit">
            <Plus size={16} />
            新建
          </button>
        </form>
        <div className="row-list">
          {schedules.data.items.map((item) => (
            <div className="row-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.cron} · next {fmtTime(item.next_run_at)}</span>
              </div>
              <IconButton title="入队" onClick={() => enqueue(item.id)}>
                <Play size={15} />
              </IconButton>
              <IconButton title="删除" onClick={() => remove(item.id)} danger>
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Reports" icon={<ClipboardList size={18} />}>
        <pre className="log-box">{JSON.stringify(reports.data.items, null, 2)}</pre>
      </Section>
    </div>
  );
}

function MemoryPage({ token }: { token: string }) {
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
    setNotice("saved");
  }

  return (
    <Section title="Memory" icon={<Database size={18} />} actions={<button className="primary-btn" type="button" onClick={save}><Save size={16} />保存</button>}>
      <div className="pathbar">
        <input value={path} onChange={(e) => setPath(e.target.value)} />
        <IconButton title="读取" onClick={load}>
          <RefreshCw size={16} />
        </IconButton>
        {notice && <span className="badge ok">{notice}</span>}
      </div>
      <textarea className="large-editor" value={content} onChange={(e) => setContent(e.target.value)} />
    </Section>
  );
}

function FilesPage({ token }: { token: string }) {
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
      <Section title="Files" icon={<FolderOpen size={18} />}>
        <div className="pathbar">
          <select value={root} onChange={(e) => setRoot(e.target.value)}>
            <option value="workspace">workspace</option>
            <option value="temp">temp</option>
            <option value="memory">memory</option>
          </select>
          <input value={path} onChange={(e) => setPath(e.target.value)} />
          <IconButton title="打开" onClick={() => browse(path)}>
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
      <Section title="Editor" icon={<Code2 size={18} />} actions={<button className="primary-btn" type="button" onClick={save}><Save size={16} />保存</button>}>
        <textarea className="large-editor" value={content} onChange={(e) => setContent(e.target.value)} />
      </Section>
    </div>
  );
}

function BrowserPage({ token }: { token: string }) {
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
      <Section title="Browser" icon={<Globe2 size={18} />}>
        <div className="cloud-note">云端 Chromium · 隔离本机登录态</div>
        <div className="pathbar">
          <input value={workerId} onChange={(e) => setWorkerId(e.target.value)} />
          <IconButton title="刷新 tabs" onClick={loadTabs}>
            <RefreshCw size={16} />
          </IconButton>
        </div>
        <div className="pathbar">
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
          <IconButton title="新建 tab" onClick={newTab}>
            <Plus size={16} />
          </IconButton>
          <IconButton title="导航" onClick={navigate}>
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
        title="Execute"
        icon={<Code2 size={18} />}
        actions={
          <>
            <IconButton title="截图" onClick={capture}>
              <HardDrive size={16} />
            </IconButton>
            <button className="primary-btn" type="button" onClick={execute}>
              <Play size={16} />
              执行
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

function LogsPage({ token, status }: { token: string; status?: StatusInfo }) {
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
      <Section title="System" icon={<ServerCog size={18} />}>
        <dl className="kv">
          <dt>data dir</dt>
          <dd>{status?.data_dir || "-"}</dd>
          <dt>configured</dt>
          <dd>{String(status?.configured ?? false)}</dd>
          <dt>concurrency</dt>
          <dd>{status?.worker_concurrency ?? "-"}</dd>
          <dt>cli runners</dt>
          <dd>{status?.cli_runner_concurrency ?? "-"}</dd>
        </dl>
      </Section>
      <Section title="Logs" icon={<FileText size={18} />} actions={<IconButton title="刷新" onClick={load}><RefreshCw size={16} /></IconButton>}>
        <div className="pathbar">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="server">server</option>
            <option value="worker">worker</option>
            <option value="scheduler">scheduler</option>
            <option value="agent">agent</option>
            <option value="browser">browser</option>
          </select>
        </div>
        <pre className="log-box tall">{content}</pre>
      </Section>
    </div>
  );
}

function AppShell({ token, setToken }: { token: string; setToken: (token: string) => void }) {
  const [page, setPage] = useState<PageKey>("chat");
  const status = useAsyncData<StatusInfo | undefined>(token, "/api/status", undefined, 5000);
  const workers = useAsyncData<WorkerInfo[]>(token, "/api/workers", [], 5000);
  const tasks = useAsyncData<Task[]>(token, "/api/tasks", [], 4000);
  const activeTasks = tasks.data.filter((task) => ["pending", "leased", "running"].includes(task.status));

  function logout() {
    localStorage.removeItem("ga_token");
    setToken("");
  }

  const content = {
    chat: <ChatPage token={token} />,
    workers: <WorkersPage token={token} />,
    queue: <QueuePage token={token} />,
    cliTools: <CliToolsPage token={token} />,
    agentRuns: <AgentRunsPage token={token} />,
    config: <ConfigPage token={token} />,
    schedules: <SchedulesPage token={token} />,
    memory: <MemoryPage token={token} />,
    files: <FilesPage token={token} />,
    browser: <BrowserPage token={token} />,
    logs: <LogsPage token={token} status={status.data} />
  }[page];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Bot size={24} />
          <span>GenericAgent</span>
        </div>
        <nav>
          {navItems.map((item) => (
            <button className={page === item.key ? "active" : ""} key={item.key} onClick={() => setPage(item.key)}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button className="logout-btn" type="button" onClick={logout}>
          <LogOut size={16} />
          退出
        </button>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{navItems.find((item) => item.key === page)?.label}</h1>
            <span>{status.data?.data_dir || "GenericAgent Web"}</span>
          </div>
          <div className="metrics">
            <span className="metric">
              <ServerCog size={15} />
              {workers.data.filter((worker) => worker.alive).length}/{workers.data.length || status.data?.worker_concurrency || 0}
            </span>
            <span className="metric">
              <Activity size={15} />
              {activeTasks.length}
            </span>
            <span className={status.data?.configured ? "badge ok" : "badge warn"}>
              {status.data?.configured ? <Check size={13} /> : <X size={13} />}
              config
            </span>
          </div>
        </header>
        <div className="content">{content}</div>
        {(status.error || workers.error || tasks.error) && (
          <div className="toast">{status.error || workers.error || tasks.error}</div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("ga_token") || "");

  useEffect(() => {
    if (!token) return;
    api("/api/auth/me", token).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem("ga_token");
        setToken("");
      }
    });
  }, [token]);

  return token ? <AppShell token={token} setToken={setToken} /> : <Login onLogin={setToken} />;
}
