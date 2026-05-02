import { Boxes, RefreshCw } from "lucide-react";
import type { WorkerInfo } from "../lib/types";
import type { T } from "../lib/i18n";
import { shortId } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function WorkersPage({ token, t }: { token: string; t: T }) {
  const workers = useAsyncData<WorkerInfo[]>(token, "/api/workers", [], 2000);
  async function restart(workerId: string) {
    await api(`/api/workers/${workerId}/restart`, token, { method: "POST" });
    await workers.refresh();
  }
  return (
    <Section title={t("workers.title")} icon={<Boxes size={18} />} actions={<IconButton title={t("common.refresh")} onClick={workers.refresh}><RefreshCw size={16} /></IconButton>}>
      <div className="worker-grid">
        {workers.data.map((worker) => (
          <article className="flat-card" key={worker.id}>
            <div className="card-row">
              <strong>{worker.id}</strong>
              <span className={worker.current_task_id ? "badge live" : worker.alive ? "badge ok" : "badge bad"}>
                {worker.current_task_id ? t("status.running") : worker.alive ? t("common.idle") : t("workers.dead")}
              </span>
            </div>
            <dl className="kv">
              <dt>{t("workers.ready")}</dt><dd>{String(worker.ready)}</dd>
              <dt>{t("workers.task")}</dt><dd>{shortId(worker.current_task_id)}</dd>
              <dt>{t("workers.lastError")}</dt><dd>{worker.last_error || "-"}</dd>
            </dl>
            <IconButton title={t("workers.restart")} onClick={() => restart(worker.id)}><RefreshCw size={16} /></IconButton>
          </article>
        ))}
        {!workers.data.length && <div className="empty">{t("workers.noWorkers")}</div>}
      </div>
    </Section>
  );
}
