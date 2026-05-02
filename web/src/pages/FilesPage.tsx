import { ChevronRight, Code2, FileText, FolderOpen, Save } from "lucide-react";
import { useState } from "react";
import type { FileItem } from "../lib/types";
import type { T } from "../lib/i18n";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function FilesPage({ token, t }: { token: string; t: T }) {
  const [root, setRoot] = useState("workspace");
  const [path, setPath] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [content, setContent] = useState("");

  async function browse(nextPath = path) {
    const data = await api<{ items?: FileItem[]; content?: string }>(
      `/api/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent(nextPath)}${nextPath && !nextPath.includes(".") ? "" : "&read=true"}`, token
    );
    if (data.items) setItems(data.items);
    if (data.content != null) setContent(data.content);
    setPath(nextPath);
  }

  async function save() {
    await api("/api/files", token, { method: "PUT", body: JSON.stringify({ root, path, content }) });
    await browse(path);
  }

  return (
    <div className="two-column wide-left">
      <Section title={t("nav.files")} icon={<FolderOpen size={18} />}>
        <div className="pathbar">
          <select value={root} onChange={(e) => setRoot(e.target.value)}>
            <option value="workspace">{t("root.workspace")}</option>
            <option value="temp">{t("root.temp")}</option>
            <option value="memory">{t("root.memory")}</option>
          </select>
          <input value={path} onChange={(e) => setPath(e.target.value)} />
          <IconButton title={t("common.open")} onClick={() => browse(path)}><ChevronRight size={16} /></IconButton>
        </div>
        <div className="row-list">
          {items.map((item) => (
            <button className="row-item file" key={item.path} onClick={() => browse(item.path)}>
              <span>{item.is_dir ? <FolderOpen size={15} /> : <FileText size={15} />}</span>
              <strong>{item.name}</strong>
              <small>{item.size} B</small>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("files.editor")} icon={<Code2 size={18} />} actions={<button className="primary-btn" type="button" onClick={save}><Save size={16} />{t("common.save")}</button>}>
        <textarea className="large-editor" value={content} onChange={(e) => setContent(e.target.value)} />
      </Section>
    </div>
  );
}
