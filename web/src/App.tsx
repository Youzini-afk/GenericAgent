import { Bot, KeyRound, Loader2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, api, login } from "./api";
import type { Lang, PageKey, StatusInfo, Task, WorkerInfo } from "./lib/types";
import { makeT, getInitialLang } from "./lib/i18n";
import type { T } from "./lib/i18n";
import { useAsyncData } from "./hooks";
import { AppShell } from "./components/layout/AppShell";
import { ChatPage } from "./pages/ChatPage";
import { WorkersPage } from "./pages/WorkersPage";
import { QueuePage } from "./pages/QueuePage";
import { CliToolsPage } from "./pages/CliToolsPage";
import { AgentRunsPage } from "./pages/AgentRunsPage";
import { ConfigPage } from "./pages/ConfigPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { MemoryPage } from "./pages/MemoryPage";
import { FilesPage } from "./pages/FilesPage";
import { BrowserPage } from "./pages/BrowserPage";
import { LogsPage } from "./pages/LogsPage";

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
        <div className="brand-mark"><Bot size={28} /></div>
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

function AppShellWrapper({ token, setToken, lang, setLang, t }: {
  token: string; setToken: (token: string) => void;
  lang: Lang; setLang: (lang: Lang) => void; t: T;
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
    <AppShell t={t} lang={lang} setLang={setLang} page={page} setPage={setPage} onLogout={logout}
      workers={workers.data} activeTasks={activeTasks} status={status.data}>
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
