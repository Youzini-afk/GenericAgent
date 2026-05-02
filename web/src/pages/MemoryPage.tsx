import { Database, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import type { T } from "../lib/i18n";
import { Section, IconButton } from "../components/ui/primitives";
import { api } from "../api";

export function MemoryPage({ token, t }: { token: string; t: T }) {
  const [path, setPath] = useState("global_mem_insight.txt");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const data = await api<{ content: string }>(`/api/memory/files/${encodeURIComponent(path).replace(/%2F/g, "/")}`, token);
    setContent(data.content);
  }

  async function save() {
    await api(`/api/memory/files/${encodeURIComponent(path).replace(/%2F/g, "/")}`, token, { method: "PUT", body: JSON.stringify({ content }) });
    setNotice(t("config.saved"));
  }

  return (
    <Section title={t("nav.memory")} icon={<Database size={18} />} actions={<button className="primary-btn" type="button" onClick={save}><Save size={16} />{t("common.save")}</button>}>
      <div className="pathbar">
        <input value={path} onChange={(e) => setPath(e.target.value)} />
        <IconButton title={t("memory.load")} onClick={load}><RefreshCw size={16} /></IconButton>
        {notice && <span className="badge ok">{notice}</span>}
      </div>
      <textarea className="large-editor" value={content} onChange={(e) => setContent(e.target.value)} />
    </Section>
  );
}
