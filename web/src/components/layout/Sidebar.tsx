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
    <aside className="app-sidebar-rail">
      <div className="app-sidebar-brand">
        <Bot size={20} style={{ flexShrink: 0 }} />
        <span>GenericAgent</span>
      </div>
      <nav className="app-sidebar-nav">
        <div className="app-sidebar-guide" />
        {navItems.map((item) => {
          const active = page === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setPage(item.key)}
              className="app-sidebar-item"
              data-active={active ? "true" : "false"}
              aria-current={active ? "page" : undefined}
            >
              <span className="app-sidebar-icon">{item.icon}</span>
              <span className="app-sidebar-label">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onLogout}
        className="app-sidebar-logout"
      >
        <LogOut size={14} />
        <span className="app-sidebar-label">{t("common.logout")}</span>
      </button>
    </aside>
  );
}
