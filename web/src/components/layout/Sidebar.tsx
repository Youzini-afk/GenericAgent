import type { ReactNode } from "react";
import type { PageKey } from "../../lib/types";
import type { I18nKey, T } from "../../lib/i18n";
import {
  Activity, Bot, Boxes, CalendarClock, Code2, Database,
  FolderOpen, Globe2, LogOut, MessageSquare, ClipboardList, ServerCog, Settings2
} from "lucide-react";

const navItems: Array<{ key: PageKey; labelKey: I18nKey; icon: ReactNode }> = [
  { key: "chat", labelKey: "nav.chat", icon: <MessageSquare size={16} /> },
  { key: "workers", labelKey: "nav.workers", icon: <Boxes size={16} /> },
  { key: "queue", labelKey: "nav.queue", icon: <ClipboardList size={16} /> },
  { key: "cliTools", labelKey: "nav.cliTools", icon: <Code2 size={16} /> },
  { key: "agentRuns", labelKey: "nav.agentRuns", icon: <Activity size={16} /> },
  { key: "config", labelKey: "nav.config", icon: <Settings2 size={16} /> },
  { key: "schedules", labelKey: "nav.schedules", icon: <CalendarClock size={16} /> },
  { key: "memory", labelKey: "nav.memory", icon: <Database size={16} /> },
  { key: "files", labelKey: "nav.files", icon: <FolderOpen size={16} /> },
  { key: "browser", labelKey: "nav.browser", icon: <Globe2 size={16} /> },
  { key: "logs", labelKey: "nav.logs", icon: <ServerCog size={16} /> }
];

export function Sidebar({ page, setPage, t, onLogout }: { page: PageKey; setPage: (p: PageKey) => void; t: T; onLogout: () => void }) {
  return (
    <aside style={{
      width: 200, minWidth: 160, display: "flex", flexDirection: "column", gap: 4,
      padding: "12px 8px", background: "var(--color-sidebar)",
      borderRight: "1px solid var(--color-border)", overflowY: "auto", flexShrink: 0
    }}>
      <div style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", fontWeight: 700, marginBottom: 4 }}>
        <Bot size={20} />
        <span style={{ fontSize: 14 }}>GenericAgent</span>
      </div>
      <nav style={{ position: "relative", display: "flex", flexDirection: "column", gap: 1 }}>
        <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, width: 2, background: "var(--color-border)" }} />
        {navItems.map((item) => {
          const active = page === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setPage(item.key)}
              style={{
                height: 31, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", borderRadius: 9999, border: 0, textAlign: "left",
                background: active ? "oklch(0.985 0 0 / 8%)" : "transparent",
                color: active ? "var(--color-foreground)" : "var(--color-muted-foreground)",
                fontWeight: active ? 600 : 400, fontSize: 13,
                transition: "background 120ms, color 120ms", cursor: "pointer",
                letterSpacing: active ? "-0.00625rem" : undefined
              }}
              onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-foreground)"; } }}
              onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--color-muted-foreground)"; } }}
            >
              <span style={{ color: active ? "var(--color-foreground)" : "var(--color-muted-foreground)", flexShrink: 0 }}>{item.icon}</span>
              {t(item.labelKey)}
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onLogout}
        style={{
          marginTop: "auto", height: 31, display: "flex", alignItems: "center", gap: 8,
          padding: "0 12px", borderRadius: 9999, border: 0, background: "transparent",
          color: "var(--color-destructive)", fontSize: 13, cursor: "pointer"
        }}
      >
        <LogOut size={14} />
        {t("common.logout")}
      </button>
    </aside>
  );
}
