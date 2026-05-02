import { Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LlmConfig } from "../lib/types";
import type { T } from "../lib/i18n";
import { asText } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { Section } from "../components/ui/primitives";
import { api } from "../api";

export function ConfigPage({ token, t }: { token: string; t: T }) {
  const config = useAsyncData<LlmConfig>(token, "/api/config/llm", { configs: [], extras: {}, path: "" });
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { setDraft(JSON.stringify(config.data.configs, null, 2)); }, [config.data.configs]);

  async function save() {
    const configs = JSON.parse(draft || "[]");
    await api("/api/config/llm", token, { method: "PUT", body: JSON.stringify({ configs, extras: config.data.extras || {} }) });
    await api("/api/runtime/reload", token, { method: "POST" });
    setNotice(t("config.saved"));
    await config.refresh();
  }

  return (
    <Section title={t("nav.config")} icon={<Settings2 size={18} />} actions={<>{notice && <span className="badge ok">{notice}</span>}<button className="primary-btn" type="button" onClick={save}><Save size={16} />{t("common.save")}</button></>}>
      <div className="split">
        <div className="flat-card">
          <dl className="kv">
            <dt>{t("config.path")}</dt><dd>{config.data.path || "-"}</dd>
            <dt>{t("config.configs")}</dt><dd>{config.data.configs.length}</dd>
          </dl>
          {config.data.configs.map((item) => (
            <div className="config-line" key={item.var}>
              <span>{item.var}</span><small>{item.kind}</small><code>{asText(item.data.model)}</code>
            </div>
          ))}
        </div>
        <textarea className="code-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
    </Section>
  );
}
