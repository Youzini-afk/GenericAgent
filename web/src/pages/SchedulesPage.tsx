import { CalendarClock, ClipboardList, Play, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Schedule } from "../lib/types";
import type { T } from "../lib/i18n";
import { fmtTime } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function SchedulesPage({ token, t }: { token: string; t: T }) {
  const schedules = useAsyncData<{ items: Schedule[] }>(token, "/api/schedules", { items: [] }, 3000);
  const reports = useAsyncData<{ items: Array<Record<string, unknown>> }>(token, "/api/schedules/reports", { items: [] }, 3000);
  const [form, setForm] = useState({ title: "", prompt: "", cron: "@every 1h", enabled: true });

  async function create(event: FormEvent) {
    event.preventDefault();
    await api("/api/schedules", token, { method: "POST", body: JSON.stringify(form) });
    setForm({ title: "", prompt: "", cron: "@every 1h", enabled: true });
    await schedules.refresh();
  }

  async function enqueue(id: string) {
    await api(`/api/schedules/${id}/enqueue`, token, { method: "POST" });
    await reports.refresh();
  }

  async function remove(id: string) {
    await api(`/api/schedules/${id}`, token, { method: "DELETE" });
    await schedules.refresh();
  }

  return (
    <div className="two-column">
      <Section title={t("nav.schedules")} icon={<CalendarClock size={18} />}>
        <form className="inline-form" onSubmit={create}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} />
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <label className="checkline">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t("schedules.enabled")}
          </label>
          <button className="primary-btn" type="submit"><Plus size={16} />{t("common.create")}</button>
        </form>
        <div className="row-list">
          {schedules.data.items.map((item) => (
            <div className="row-item" key={item.id}>
              <div><strong>{item.title}</strong><span>{item.cron} · {t("schedules.next")} {fmtTime(item.next_run_at)}</span></div>
              <IconButton title={t("schedules.enqueue")} onClick={() => enqueue(item.id)}><Play size={15} /></IconButton>
              <IconButton title={t("common.delete")} onClick={() => remove(item.id)} danger><Trash2 size={15} /></IconButton>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t("schedules.reports")} icon={<ClipboardList size={18} />}>
        <pre className="log-box">{JSON.stringify(reports.data.items, null, 2)}</pre>
      </Section>
    </div>
  );
}
