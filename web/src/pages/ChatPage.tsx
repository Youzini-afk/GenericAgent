import { CircleStop, MessageSquare, Plus, Send } from "lucide-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import type { Session, Message, Task, TaskEvent, CliRun } from "../lib/types";
import type { T } from "../lib/i18n";
import { shortId, asText, changedCount, blockersCount, orchestrationMeta, statusLabel, cliStatusClass } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { StatusIcon } from "../components/common/StatusIcon";
import { Shimmer } from "../components/common/Shimmer";
import { api } from "../api";

marked.setOptions({ breaks: true });

function MessageContent({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return <div className="msg-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ChildRunsTree({ runs, onOpenRun, t }: { runs: CliRun[]; onOpenRun: (id: string) => void; t: T }) {
  if (!runs.length) return null;
  return (
    <div className="child-runs-tree">
      {runs.slice(0, 8).map((run) => {
        const meta = orchestrationMeta(run);
        const isRunning = run.status === "running" || run.status === "preparing";
        return (
          <button key={run.id} type="button" className="child-run-row" onClick={() => onOpenRun(run.id)}>
            <span className="child-run-icon"><StatusIcon status={run.status} size={10} /></span>
            <span className="child-run-provider">{run.provider}</span>
            {meta.mode && <span className="child-run-mode">{meta.mode}</span>}
            <span className="child-run-status">
              {isRunning ? <Shimmer>{statusLabel(t, run.status)}</Shimmer> : statusLabel(t, run.status)}
            </span>
            <span className="child-run-meta">
              {changedCount(run.result) > 0 && `${changedCount(run.result)}f`}
              {blockersCount(run.result) > 0 && ` · ${blockersCount(run.result)} blocker`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChatPage({ token, t, onOpenRun }: { token: string; t: T; onOpenRun: (runId: string) => void }) {
  const sessions = useAsyncData<Session[]>(token, "/api/sessions", [], 3000);
  const tasks = useAsyncData<Task[]>(token, "/api/tasks", [], 2000);
  const [active, setActive] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [childRuns, setChildRuns] = useState<CliRun[]>([]);
  const [watchTask, setWatchTask] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!active && sessions.data.length) setActive(sessions.data[0].id);
  }, [active, sessions.data]);

  const loadMessages = useCallback(async () => {
    if (!active) return;
    setMessages(await api<Message[]>(`/api/sessions/${active}/messages`, token));
  }, [active, token]);

  useEffect(() => { loadMessages().catch(() => undefined); }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, events]);

  useEffect(() => {
    if (!active) return;
    let canceled = false;
    async function load() {
      try {
        const data = await api<{ items: CliRun[] }>(`/api/sessions/${active}/cli-runs`, token);
        if (!canceled) setChildRuns(data.items);
      } catch { if (!canceled) setChildRuns([]); }
    }
    load();
    const timer = window.setInterval(load, 2500);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [active, token]);

  useEffect(() => {
    if (!watchTask) return;
    let canceled = false, seq = 0;
    async function poll() {
      try {
        const data = await api<{ events: TaskEvent[] }>(`/api/tasks/${watchTask}/events?after_seq=${seq}`, token);
        if (canceled) return;
        if (data.events.length) {
          seq = Math.max(...data.events.map((e) => e.seq));
          setEvents((prev) => [...prev, ...data.events]);
          if (data.events.some((e) => e.type === "done" || e.type === "error")) {
            setSending(false);
            loadMessages().catch(() => undefined);
          }
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

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!active || !draft.trim() || sending) return;
    const content = draft.trim();
    setDraft("");
    setSending(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, session_id: active, role: "user", content, created_at: Date.now() / 1000 }]);
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    try {
      const data = await api<{ task_id: string }>(`/api/sessions/${active}/messages`, token, { method: "POST", body: JSON.stringify({ content }) });
      setWatchTask(data.task_id);
      setEvents([]);
      await tasks.refresh();
    } catch { setSending(false); }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  }

  const activeTasks = tasks.data.filter((t) => t.session_id === active && ["pending", "leased", "running"].includes(t.status));
  const activeSession = sessions.data.find((s) => s.id === active);

  return (
    <div className="chat-layout">
      {/* 会话列表 */}
      <aside className="sessions-pane">
        <div className="sessions-header">
          <span className="sessions-title">{t("chat.sessions")}</span>
          <button type="button" className="icon-btn-ghost" title={t("chat.newSession")} onClick={newSession}>
            <Plus size={15} />
          </button>
        </div>
        <div className="sessions-list">
          {sessions.data.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`session-row${active === session.id ? " active" : ""}`}
              onClick={() => setActive(session.id)}
            >
              <MessageSquare size={13} className="session-row-icon" />
              <span className="session-row-title">{session.title}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* 主对话区 */}
      <div className="chat-body">
        {/* 顶部标题栏 */}
        <div className="chat-titlebar">
          <span className="chat-session-name">{activeSession?.title || t("chat.title")}</span>
          <div className="chat-titlebar-right">
            {activeTasks.map((task) => (
              <span key={task.id} className="task-pill">
                <span className="task-pill-dot" />
                {shortId(task.id)}
              </span>
            ))}
          </div>
        </div>

        {/* child-runs 树 */}
        {childRuns.length > 0 && <ChildRunsTree runs={childRuns} onOpenRun={onOpenRun} t={t} />}

        {/* 消息流 */}
        <div className="messages-scroll">
          {messages.map((msg) => (
            <div key={msg.id} className={`msg-row ${msg.role === "user" ? "msg-user" : "msg-agent"}`}>
              <div className="msg-bubble">
                <div className="msg-role">{msg.role === "user" ? t("role.user") : t("role.agent")}</div>
                <MessageContent content={msg.content} />
              </div>
            </div>
          ))}
          {events.length > 0 && (
            <div className="msg-row msg-agent">
              <div className="msg-bubble msg-streaming">
                <div className="msg-role">
                  <Shimmer>{t("chat.task")} {shortId(watchTask)}</Shimmer>
                </div>
                <pre className="msg-stream-pre">{events.map((e) => asText(e.payload.text || e.payload.error || e.type)).join("")}</pre>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div className="composer-wrap">
          <form className="composer-box" onSubmit={sendMessage}>
            <textarea
              ref={textareaRef}
              className="composer-textarea"
              value={draft}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={sending ? t("common.idle") + "…" : "Send a message  (Enter ↵)"}
              rows={1}
              disabled={!active}
            />
            <div className="composer-footer">
              <span className="composer-hint">Shift+Enter 换行</span>
              <div className="composer-actions">
                {activeTasks.map((task) => (
                  <button key={task.id} type="button" className="icon-btn-ghost danger" title={t("chat.cancelTask", { id: shortId(task.id) })}
                    onClick={() => api(`/api/tasks/${task.id}/cancel`, token, { method: "POST" }).then(() => tasks.refresh())}>
                    <CircleStop size={15} />
                  </button>
                ))}
                <button className="send-btn" type="submit" disabled={!active || !draft.trim() || sending}>
                  <Send size={14} />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
