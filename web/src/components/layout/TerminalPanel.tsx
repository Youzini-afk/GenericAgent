import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { T } from "../../lib/i18n";

export function TerminalPanel({ t, children }: { t: T; children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{
      height: collapsed ? 32 : 220, flexShrink: 0,
      display: "flex", flexDirection: "column",
      background: "var(--color-muted)", borderTop: "1px solid var(--color-border)",
      transition: "height 150ms"
    }}>
      <div style={{
        height: 32, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px", borderBottom: collapsed ? 0 : "1px solid var(--color-border)",
        flexShrink: 0
      }}>
        <span style={{ fontSize: 12, color: "var(--color-muted-foreground)", fontWeight: 600 }}>Terminal</span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          style={{ background: "transparent", border: 0, color: "var(--color-muted-foreground)", cursor: "pointer", padding: 4 }}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
          {children || <span style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>No output</span>}
        </div>
      )}
    </div>
  );
}
