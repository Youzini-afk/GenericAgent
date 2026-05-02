import { Bot, KeyRound, Loader2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { ApiError, api, login } from "./api";
import type { CliRun, CliRunEvent, Lang, PageKey, StatusInfo, Task, WorkerInfo } from "./lib/types";
import { makeT, getInitialLang } from "./lib/i18n";
import type { T } from "./lib/i18n";
import { useAsyncData } from "./hooks";
import { useCliRunStream } from "./useCliRunStream";
import { AppShell } from "./components/layout/AppShell";
import { ChatPage } from "./pages/ChatPage";
import { AgentRunsPage } from "./pages/AgentRunsPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";

const FINAL_CLI_RUN_EVENTS = ["done", "error", "canceled"];

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

function RunDetailLoader({ runId, token, children }: {
  runId: string; token: string;
  children: (detail: { run: CliRun; events: CliRunEvent[]; diff: string; result: Record<string, unknown> } | undefined) => React.ReactNode;
}) {
  const [run, setRun] = useState<CliRun | undefined>();
  const [diff, setDiff] = useState("");
  const [result, setResult] = useState<Record<string, unknown>>({});
  const wsEvents = useCliRunStream(runId, token);

  const loadStatic = useCallback(async () => {
    if (!runId) return;
    const [runData, diffData, resultData] = await Promise.all([
      api<CliRun>(`/api/cli-runs/${runId}`, token),
      api<{ content: string }>(`/api/cli-runs/${runId}/diff`, token),
      api<Record<string, unknown>>(`/api/cli-runs/${runId}/result`, token)
    ]);
    setRun(runData);
    setDiff(diffData.content);
    setResult(resultData);
  }, [runId, token]);

  useEffect(() => {
    if (!runId) { setRun(undefined); setDiff(""); setResult({}); return; }
    loadStatic().catch(() => undefined);
  }, [loadStatic, runId]);

  const lastEvent = wsEvents[wsEvents.length - 1];
  useEffect(() => {
    if (lastEvent && FINAL_CLI_RUN_EVENTS.includes(lastEvent.type)) loadStatic().catch(() => undefined);
  }, [lastEvent, loadStatic]);

  if (!run) return <>{children(undefined)}</>;
  return <>{children({ run, events: wsEvents, diff, result })}</>;
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

  useEffect(() => {
    const err = status.error || workers.error || tasks.error;
    if (err) toast.error(err);
  }, [status.error, workers.error, tasks.error]);

  function logout() {
    localStorage.removeItem("ga_token");
    setToken("");
  }

  const content: Record<PageKey, React.ReactNode> = {
    chat: <ChatPage token={token} t={t} onOpenRun={(runId) => setSelectedCliRun(runId)} />,
    agentRuns: <AgentRunsPage token={token} t={t} selectedRunId={selectedCliRun} onSelectedRun={setSelectedCliRun} />,
    queue: <QueuePage token={token} t={t} />,
    settings: <SettingsPage token={token} t={t} status={status.data} />,
  };

  return (
    <RunDetailLoader runId={selectedCliRun} token={token}>
      {(runDetail) => (
        <AppShell t={t} lang={lang} setLang={setLang} page={page} setPage={setPage} onLogout={logout}
          workers={workers.data} activeTasks={activeTasks} status={status.data} runDetail={runDetail}>
          {content[page]}
        </AppShell>
      )}
    </RunDetailLoader>
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

  return (
    <>
      <Toaster theme="dark" position="bottom-right" />
      {token ? <AppShellWrapper token={token} setToken={setToken} lang={lang} setLang={setLang} t={t} /> : <Login onLogin={setToken} t={t} />}
    </>
  );
}
