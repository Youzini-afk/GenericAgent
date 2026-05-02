import type { ReactNode } from "react";
import type { PageKey } from "../../lib/types";
import type { I18nKey, T } from "../../lib/i18n";
import { Activity, Bot, ClipboardList, LogOut, MessageSquare, Settings2 } from "lucide-react";

const mainNav: Array<{ key: PageKey; labelKey: I18nKey; icon: ReactNode }> = [
  { key: "chat", labelKey: "nav.chat", icon: <MessageSquare size={16} /> },
  { key: "agentRuns", labelKey: "nav.agentRuns", icon: <Activity size={16} /> },
  { key: "queue", labelKey: "nav.queue", icon: <ClipboardList size={16} /> },
];

export function Sidebar({ page, setPage, t, onLogout }: {
  page: PageKey; setPage: (p: PageKey) => void; t: T; onLogout: () => void;
}) {
  return (
    <aside className="app-sidebar-rail">
      <div className="app-sidebar-brand">
        <Bot size={20} style={{ flexShrink: 0 }} />
        <span>GenericAgent</span>
      </div>
      <nav className="app-sidebar-nav">
        <div className="app-sidebar-guide" />
        {mainNav.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setPage(item.key)}
            className="app-sidebar-item"
            data-active={page === item.key ? "true" : "false"}
          >
            <span className="app-sidebar-icon">{item.icon}</span>
            <span className="app-sidebar-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
        <button
          type="button"
          onClick={() => setPage("settings")}
          className="app-sidebar-item"
          data-active={page === "settings" ? "true" : "false"}
        >
          <span className="app-sidebar-icon"><Settings2 size={16} /></span>
          <span className="app-sidebar-label">{t("nav.settings")}</span>
        </button>
        <button type="button" onClick={onLogout} className="app-sidebar-logout">
          <LogOut size={14} />
          <span className="app-sidebar-label">{t("common.logout")}</span>
        </button>
      </div>
    </aside>
  );
}
