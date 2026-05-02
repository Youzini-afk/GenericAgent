import type { WorkerInfo, StatusInfo, Task } from "../../lib/types";
import type { T } from "../../lib/i18n";

export function StatusBar({ t, workers, activeTasks, status }: { t: T; workers: WorkerInfo[]; activeTasks: Task[]; status?: StatusInfo }) {
  return (
    <footer style={{
      height: 24, display: "flex", alignItems: "center", gap: 12,
      padding: "0 12px", background: "var(--color-sidebar)",
      borderTop: "1px solid var(--color-border)", flexShrink: 0, fontSize: 11,
      color: "var(--color-muted-foreground)"
    }}>
      <span>workers: {workers.filter((w) => w.alive).length}/{workers.length || status?.worker_concurrency || 0}</span>
      <span>tasks: {activeTasks.length}</span>
      <span>cli: {status?.active_cli_runs ?? 0}</span>
      {status?.data_dir && <span style={{ marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.data_dir}</span>}
    </footer>
  );
}
