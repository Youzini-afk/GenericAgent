import { Activity, Check, Code2, Languages, ServerCog, X } from "lucide-react";
import type { WorkerInfo, StatusInfo, Task, Lang } from "../../lib/types";
import type { T } from "../../lib/i18n";

export function TopBar({
  t, lang, setLang, workers, activeTasks, status
}: {
  t: T; lang: Lang; setLang: (l: Lang) => void;
  workers: WorkerInfo[]; activeTasks: Task[]; status?: StatusInfo;
}) {
  return (
    <header style={{
      height: 40, display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 16px", background: "var(--color-card)", borderBottom: "1px solid var(--color-border)",
      flexShrink: 0, gap: 12
    }}>
      <span style={{ fontSize: 13, color: "var(--color-muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {status?.data_dir || t("app.subtitle")}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <label className="language-select" title={t("common.language")}>
          <Languages size={13} />
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <span className="metric"><ServerCog size={13} />{workers.filter((w) => w.alive).length}/{workers.length || status?.worker_concurrency || 0}</span>
        <span className="metric"><Activity size={13} />{activeTasks.length}</span>
        <span className="metric"><Code2 size={13} />{t("topbar.cliRuns")} {status?.active_cli_runs ?? 0}</span>
        <span className={status?.configured ? "badge ok" : "badge warn"}>
          {status?.configured ? <Check size={12} /> : <X size={12} />}
          {t("topbar.config")}
        </span>
      </div>
    </header>
  );
}
