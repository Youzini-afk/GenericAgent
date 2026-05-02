import { CircleStop, Plus, Send } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Session, Message, Task, TaskEvent, CliRun } from "../lib/types";
import type { T } from "../lib/i18n";
import { shortId, asText, changedCount, blockersCount, orchestrationMeta, statusLabel, statusClass, cliStatusClass } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { IconButton } from "../components/ui/primitives";
import { StatusIcon } from "../components/common/StatusIcon";
import { Shimmer } from "../components/common/Shimmer";
import { api } from "../api";

export function ChatPage({ token, t, onOpenRun }: { token: string; t: T; onOpenRun: (runId: string) => void }) {
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

  useEffect(() => { loadMessages().catch((err) => setError(err.message)); }, [loadMessages]);

  useEffect(() => {
    if (!active) return;
    let canceled = false;
    async function loadChildRuns() {
      try {
        const data = await api<{ items: CliRun[] }>(`/api/sessions/${active}/cli-runs`, token);
        if (!canceled) setChildRuns(data.items);
      } catch { if (!canceled) setChildRuns([]); }
    }
    loadChildRuns();
    const timer = window.setInterval(loadChildRuns, 2500);
    return () => { canceled = true; window.clearInterval(timer); };
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
      } catch { return; }
    }
    poll();
    const timer = window.setInterval(poll, 900);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [loadMessages, token, watchTask]);

  async function newSession() {
    const session = await api<Session>("/api/sessions", token, { method: "POST", body: JSON.stringify({ title: t("chat.newSessionTitle") }) });
    setActive(session.id);
    await sessions.refresh();
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, session_id: active, role: "user", content, created_at: Date.now() / 1000 }]);
    try {
      const data = await api<{ task_id: string; queue_position: number }>(`/api/sessions/${active}/messages`, token, { method: "POST", body: JSON.stringify({ content }) });
      setWatchTask(data.task_id);
      setEvents([]);
      await tasks.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
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
          <IconButton title={t("chat.newSession")} onClick={newSession}><Plus size={16} /></IconButton>
        </div>
        <div className="session-list">
          {sessions.data.map((session) => (
            <button className={`session-item ${active === session.id ? "active" : ""}`} key={session.id} onClick={() => setActive(session.id)}>
              <span>{session.title}</span>
              <small>{new Date(session.updated_at * 1000).toLocaleString()}</small>
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
          <div style={{ borderBottom: "1px solid var(--color-border)", padding: "8px 16px", background: "var(--color-muted)" }}>
            <div style={{ borderLeft: "2px solid var(--color-border)", marginLeft: 4, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {childRuns.slice(0, 6).map((run) => {
                const meta = orchestrationMeta(run);
                const isRunning = run.status === "running";
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => onOpenRun(run.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
                      background: "transparent", border: 0, borderRadius: 6, cursor: "pointer",
                      textAlign: "left", color: "var(--color-foreground)"
                    }}
                  >
                    <span style={{ color: isRunning ? "oklch(0.75 0.15 60)" : run.status === "succeeded" ? "oklch(0.7 0.15 145)" : run.status === "failed" ? "var(--color-destructive)" : "var(--color-muted-foreground)", flexShrink: 0 }}>
                      <StatusIcon status={run.status} size={10} />
                    </span>
                    <span style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>{run.provider}</span>
                    {meta.mode && <span style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>· {meta.mode}</span>}
                    <span style={{ fontSize: 12 }}>
                      {isRunning ? <Shimmer>{statusLabel(t, run.status)}</Shimmer> : statusLabel(t, run.status)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-muted-foreground)", marginLeft: "auto" }}>
                      {t("common.filesCount", { count: changedCount(run.result) })} · {t("agentRuns.blockers")} {blockersCount(run.result)}
                    </span>
                  </button>
                );
              })}
            </div>
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
              <Send size={16} />{t("chat.send")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
