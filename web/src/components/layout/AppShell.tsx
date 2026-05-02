import type { ReactNode } from "react";
import type { PageKey, Lang, WorkerInfo, StatusInfo, Task, CliRun, CliRunEvent } from "../../lib/types";
import type { T } from "../../lib/i18n";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
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
  const showAux = !!runDetail;

  return (
    <div className="app-shell-root">
      <TopBar t={t} lang={lang} setLang={setLang} workers={workers} activeTasks={activeTasks} status={status} />
      <PanelGroup orientation="vertical" className="app-shell-vertical">
        <Panel defaultSize={80} minSize={50}>
          <div className="app-shell-body">
            <Sidebar page={page} setPage={setPage} t={t} onLogout={onLogout} />
            <PanelGroup orientation="horizontal" className="app-shell-workspace">
              <Panel defaultSize={showAux ? 68 : 100} minSize={48}>
                <main className="app-shell-main">
                  {children}
                </main>
              </Panel>
              {showAux && (
                <>
                  <PanelResizeHandle className="resize-handle resize-handle-vertical" />
                  <Panel defaultSize={32} minSize={20} maxSize={45}>
                    <AuxPanel t={t} runDetail={runDetail} />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle-horizontal" />
        <Panel defaultSize={20} minSize={4} maxSize={40} collapsible>
          <TerminalPanel t={t} />
        </Panel>
      </PanelGroup>
      <StatusBar t={t} workers={workers} activeTasks={activeTasks} status={status} />
    </div>
  );
}
