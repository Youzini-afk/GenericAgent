import { Activity, X, ListTree, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import type { Task } from "../lib/types";
import type { T } from "../lib/i18n";
import { shortId, fmtTime, statusLabel, statusClass } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function QueuePage({ token, t }: { token: string; t: T }) {
  const tasks = useAsyncData<Task[]>(token, "/api/tasks", [], 1800);
  const grouped = useMemo(() => ({
    active: tasks.data.filter((task) => ["pending", "leased", "running"].includes(task.status)),
    history: tasks.data.filter((task) => !["pending", "leased", "running"].includes(task.status))
  }), [tasks.data]);

  async function cancel(taskId: string) {
    await api(`/api/tasks/${taskId}/cancel`, token, { method: "POST" });
    await tasks.refresh();
  }

  function table(items: Task[]) {
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>{t("table.id")}</th><th>{t("table.kind")}</th><th>{t("table.session")}</th>
            <th>{t("table.status")}</th><th>{t("table.worker")}</th><th>{t("table.updated")}</th><th />
          </tr></thead>
          <tbody>
            {items.map((task) => (
              <tr key={task.id}>
                <td>{shortId(task.id)}</td><td>{task.kind}</td><td>{shortId(task.session_id)}</td>
                <td><span className={statusClass[task.status]}>{statusLabel(t, task.status)}</span></td>
                <td>{task.leased_by || "-"}</td><td>{fmtTime(task.updated_at)}</td>
                <td>{["pending", "leased", "running"].includes(task.status) && (
                  <IconButton title={t("common.cancel")} onClick={() => cancel(task.id)} danger><X size={15} /></IconButton>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <Section title={t("queue.active")} icon={<Activity size={18} />} actions={<IconButton title={t("common.refresh")} onClick={tasks.refresh}><RefreshCw size={16} /></IconButton>}>
        {table(grouped.active)}
      </Section>
      <Section title={t("queue.history")} icon={<ListTree size={18} />}>{table(grouped.history)}</Section>
    </>
  );
}
