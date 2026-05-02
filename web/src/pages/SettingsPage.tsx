import type { SettingsKey } from "../lib/types";
import type { T } from "../lib/i18n";
import { useState } from "react";
import { Code2, Database, FolderOpen, Globe2, ServerCog, Settings2, CalendarClock, Boxes } from "lucide-react";
import { WorkersPage } from "./WorkersPage";
import { ConfigPage } from "./ConfigPage";
import { CliToolsPage } from "./CliToolsPage";
import { SchedulesPage } from "./SchedulesPage";
import { MemoryPage } from "./MemoryPage";
import { FilesPage } from "./FilesPage";
import { BrowserPage } from "./BrowserPage";
import { LogsPage } from "./LogsPage";
import type { StatusInfo } from "../lib/types";

const groups: Array<{ label: { zh: string; en: string }; items: Array<{ key: SettingsKey; icon: React.ReactNode; labelKey: string }> }> = [
  {
    label: { zh: "系统", en: "System" },
    items: [
      { key: "config", icon: <Settings2 size={15} />, labelKey: "settings.config" },
      { key: "workers", icon: <Boxes size={15} />, labelKey: "settings.workers" },
      { key: "logs", icon: <ServerCog size={15} />, labelKey: "settings.logs" },
    ]
  },
  {
    label: { zh: "工具", en: "Tools" },
    items: [
      { key: "cliTools", icon: <Code2 size={15} />, labelKey: "settings.cliTools" },
      { key: "schedules", icon: <CalendarClock size={15} />, labelKey: "settings.schedules" },
    ]
  },
  {
    label: { zh: "数据", en: "Data" },
    items: [
      { key: "memory", icon: <Database size={15} />, labelKey: "settings.memory" },
      { key: "files", icon: <FolderOpen size={15} />, labelKey: "settings.files" },
      { key: "browser", icon: <Globe2 size={15} />, labelKey: "settings.browser" },
    ]
  }
];

export function SettingsPage({ token, t, status }: { token: string; t: T; status?: StatusInfo }) {
  const [active, setActive] = useState<SettingsKey>("config");

  const content: Record<SettingsKey, React.ReactNode> = {
    config: <ConfigPage token={token} t={t} />,
    workers: <WorkersPage token={token} t={t} />,
    cliTools: <CliToolsPage token={token} t={t} />,
    schedules: <SchedulesPage token={token} t={t} />,
    memory: <MemoryPage token={token} t={t} />,
    files: <FilesPage token={token} t={t} />,
    browser: <BrowserPage token={token} t={t} />,
    logs: <LogsPage token={token} status={status} t={t} />,
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <nav style={{
        width: 200, flexShrink: 0, borderRight: "1px solid var(--color-border)",
        background: "var(--color-sidebar)", padding: "12px 8px", overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 16
      }}>
        {groups.map((group) => (
          <div key={group.label.zh}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted-foreground)", padding: "0 10px", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("nav.settings") === "Settings" ? group.label.en : group.label.zh}
            </div>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(item.key)}
                className="app-sidebar-item"
                data-active={active === item.key ? "true" : "false"}
                style={{ width: "100%" }}
              >
                <span className="app-sidebar-icon">{item.icon}</span>
                <span className="app-sidebar-label">{t(item.labelKey as Parameters<T>[0])}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
        {content[active]}
      </div>
    </div>
  );
}
