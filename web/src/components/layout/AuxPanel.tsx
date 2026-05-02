import type { ReactNode } from "react";
import type { T } from "../../lib/i18n";

export function AuxPanel({ t, children }: { t: T; children?: ReactNode }) {
  return (
    <aside style={{
      width: 340, minWidth: 280, display: "flex", flexDirection: "column",
      background: "var(--color-card)", borderLeft: "1px solid var(--color-border)",
      flexShrink: 0, overflow: "hidden"
    }}>
      <div style={{
        height: 36, display: "flex", alignItems: "center", padding: "0 12px",
        borderBottom: "1px solid var(--color-border)", fontSize: 12,
        color: "var(--color-muted-foreground)", fontWeight: 600
      }}>
        {t("common.summary")}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {children || <div className="empty">{t("agentRuns.selectRun")}</div>}
      </div>
    </aside>
  );
}
