import type { ReactNode } from "react";
import type { PageKey, Lang, WorkerInfo, StatusInfo, Task, CliRun, CliRunEvent } from "../../lib/types";
import type { T } from "../../lib/i18n";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { AuxPanel } from "./AuxPanel";
import { TerminalPanel } from "./TerminalPanel";

export function AppShell({
  t, lang, setLang, page, setPage, onLogout,
  workers, activeTasks, status, runDetail, children
}: {
  t: T; lang: Lang; setLang: (l: Lang) => void;
  page: PageKey; setPage: (p: PageKey) => void; onLogout: () => void;
  workers: WorkerInfo[]; activeTasks: Task[]; status?: StatusInfo;
  runDetail?: { run: CliRun; events: CliRunEvent[]; diff: string; result: Record<string, unknown> };
  children: ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar t={t} lang={lang} setLang={setLang} workers={workers} activeTasks={activeTasks} status={status} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Sidebar page={page} setPage={setPage} t={t} onLogout={onLogout} />
        <main style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18, background: "var(--color-background)" }}>
          {children}
        </main>
        <AuxPanel t={t} runDetail={runDetail} />
      </div>
      <TerminalPanel t={t} />
      <StatusBar t={t} workers={workers} activeTasks={activeTasks} status={status} />
    </div>
  );
}
