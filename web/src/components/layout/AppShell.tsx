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
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar t={t} lang={lang} setLang={setLang} workers={workers} activeTasks={activeTasks} status={status} />
      <PanelGroup orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={76} minSize={45}>
          <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
            <Panel defaultSize={15} minSize={11} maxSize={24}>
              <Sidebar page={page} setPage={setPage} t={t} onLogout={onLogout} />
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-vertical" />
            <Panel defaultSize={62} minSize={36}>
              <main style={{ height: "100%", minWidth: 0, overflow: "auto", padding: 18, background: "var(--color-background)" }}>
                {children}
              </main>
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-vertical" />
            <Panel defaultSize={23} minSize={16} maxSize={38}>
              <AuxPanel t={t} runDetail={runDetail} />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle-horizontal" />
        <Panel defaultSize={24} minSize={5} maxSize={42}>
          <TerminalPanel t={t} />
        </Panel>
      </PanelGroup>
      <StatusBar t={t} workers={workers} activeTasks={activeTasks} status={status} />
    </div>
  );
}
