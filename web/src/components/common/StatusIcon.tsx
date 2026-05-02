import type { CliRunStatus, Status } from "../../lib/types";

type AnyStatus = Status | CliRunStatus;

export function StatusIcon({ status, size = 10 }: { status: AnyStatus; size?: number }) {
  const s = size;
  if (status === "running") {
    return (
      <svg width={s} height={s} viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M5 1 A4 4 0 0 1 9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 5 5" to="360 5 5" dur="1.1s" repeatCount="indefinite" />
        </path>
      </svg>
    );
  }
  if (status === "succeeded") {
    return (
      <svg width={s} height={s} viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 5l1.5 1.5L7 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "failed" || status === "interrupted") {
    return (
      <svg width={s} height={s} viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.5 3.5l3 3M6.5 3.5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "preparing") {
    return (
      <svg width={s} height={s} viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
        <circle cx="5" cy="5" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" fill="none">
      <circle cx="5" cy="5" r="4" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
      <circle cx="5" cy="5" r="1.5" fill="currentColor" strokeOpacity="0.6" />
    </svg>
  );
}
