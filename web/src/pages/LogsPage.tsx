import { FileText, RefreshCw, ServerCog } from "lucide-react";
import { useEffect, useState } from "react";
import type { StatusInfo } from "../lib/types";
import type { T } from "../lib/i18n";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function LogsPage({ token, status, t }: { token: string; status?: StatusInfo; t: T }) {
  const [kind, setKind] = useState("server");
  const [content, setContent] = useState("");

  async function load() {
    const data = await api<{ content: string }>(`/api/logs?kind=${encodeURIComponent(kind)}&lines=300`, token);
    setContent(data.content);
  }

  useEffect(() => { load().catch(() => undefined); }, [kind]);

  return (
    <div className="two-column">
      <Section title={t("logs.system")} icon={<ServerCog size={18} />}>
        <dl className="kv">
          <dt>{t("logs.dataDir")}</dt><dd>{status?.data_dir || "-"}</dd>
          <dt>{t("logs.configured")}</dt><dd>{String(status?.configured ?? false)}</dd>
          <dt>{t("logs.concurrency")}</dt><dd>{status?.worker_concurrency ?? "-"}</dd>
          <dt>{t("logs.cliRunners")}</dt><dd>{status?.cli_runner_concurrency ?? "-"}</dd>
          <dt>{t("logs.activeCliRuns")}</dt><dd>{status?.active_cli_runs ?? "-"}</dd>
        </dl>
      </Section>
      <Section title={t("logs.logs")} icon={<FileText size={18} />} actions={<IconButton title={t("common.refresh")} onClick={load}><RefreshCw size={16} /></IconButton>}>
        <div className="pathbar">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="server">{t("logKind.server")}</option>
            <option value="worker">{t("logKind.worker")}</option>
            <option value="scheduler">{t("logKind.scheduler")}</option>
            <option value="agent">{t("logKind.agent")}</option>
            <option value="browser">{t("logKind.browser")}</option>
          </select>
        </div>
        <pre className="log-box tall">{content}</pre>
      </Section>
    </div>
  );
}
