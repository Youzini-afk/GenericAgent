import type { CliRunStatus, Status } from "../../lib/types";

type AnyStatus = Status | CliRunStatus;

const statusStyles: Record<string, string> = {
  running: "bg-amber-500/20 text-amber-500",
  preparing: "bg-amber-500/20 text-amber-500",
  succeeded: "bg-green-500/20 text-green-500",
  failed: "badge bad",
  interrupted: "badge bad",
  canceled: "badge muted",
  pending: "badge muted",
  leased: "badge warn"
};

export function StatusBadge({ status, label }: { status: AnyStatus; label: string }) {
  const cls = statusStyles[status] || "badge muted";
  return <span className={`badge ${cls}`}>{label}</span>;
}
