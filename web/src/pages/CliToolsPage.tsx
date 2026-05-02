import { Code2, HardDrive, KeyRound, Play, RefreshCw, Save } from "lucide-react";
import { FormEvent, useState } from "react";
import type { CliTool, CliEnvProfile, CliProviderProfile } from "../lib/types";
import type { T } from "../lib/i18n";
import { asText, fmtTime, toolStatusLabel } from "../lib/utils";
import { useAsyncData } from "../hooks";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function CliToolsPage({ token, t }: { token: string; t: T }) {
  const tools = useAsyncData<{ items: CliTool[] }>(token, "/api/cli-tools", { items: [] }, 4000);
  const profiles = useAsyncData<{ items: CliEnvProfile[] }>(token, "/api/cli-env-profiles", { items: [] }, 4000);
  const providerProfiles = useAsyncData<{ items: CliProviderProfile[] }>(token, "/api/cli-provider-profiles", { items: [] }, 4000);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState({ name: "", tool_id: "codex" });
  const [envText, setEnvText] = useState('{\n  "OPENAI_API_KEY": ""\n}');
  const [notice, setNotice] = useState("");

  async function install(toolId: string) {
    setNotice(t("cliTools.installing", { id: toolId }));
    await api(`/api/cli-tools/${toolId}/install`, token, { method: "POST", body: JSON.stringify({ version: versions[toolId] || "latest" }) });
    setNotice(t("cliTools.installed", { id: toolId }));
    await tools.refresh();
  }

  async function test(toolId: string) {
    const result = await api<Record<string, unknown>>(`/api/cli-tools/${toolId}/test`, token, { method: "POST" });
    setNotice(`${toolId}: ${asText(result.detected_version || result.stderr || result.stdout)}`);
    await tools.refresh();
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const env = JSON.parse(envText || "{}");
    await api("/api/cli-env-profiles", token, { method: "POST", body: JSON.stringify({ ...profile, env }) });
    setProfile({ name: "", tool_id: "codex" });
    await profiles.refresh();
  }

  return (
    <div className="two-column wide-left">
      <Section title={t("cliTools.title")} icon={<Code2 size={18} />} actions={<>{notice && <span className="badge neutral">{notice}</span>}<IconButton title={t("common.refresh")} onClick={tools.refresh}><RefreshCw size={16} /></IconButton></>}>
        <div className="tool-grid">
          {tools.data.items.map((tool) => {
            const pp = providerProfiles.data.items.find((p) => p.provider === tool.id);
            return (
              <article className="flat-card" key={tool.id}>
                <div className="card-row">
                  <strong>{tool.name}</strong>
                  <span className={tool.status === "installed" ? "badge ok" : tool.status === "broken" ? "badge bad" : "badge neutral"}>{toolStatusLabel(t, tool.status)}</span>
                </div>
                <dl className="kv">
                  <dt>{t("cliTools.package")}</dt><dd>{tool.package || "-"}</dd>
                  <dt>{t("cliTools.version")}</dt><dd>{tool.resolved_version || tool.requested_version || "-"}</dd>
                  <dt>{t("cliTools.command")}</dt><dd>{tool.command_path || tool.command || "-"}</dd>
                  <dt>{t("cliTools.error")}</dt><dd>{tool.error || "-"}</dd>
                  <dt>{t("cliTools.strengths")}</dt><dd>{pp?.strengths?.join(", ") || "-"}</dd>
                  <dt>{t("cliTools.recent")}</dt><dd>{pp ? `${pp.recent_success}/${pp.recent_failure}` : "-"}</dd>
                  <dt>{t("cliTools.notes")}</dt><dd>{pp?.notes?.slice(-2).join("; ") || "-"}</dd>
                </dl>
                <div className="pathbar compact">
                  <input value={versions[tool.id] || "latest"} onChange={(e) => setVersions({ ...versions, [tool.id]: e.target.value })} />
                  <IconButton title={t("cliTools.install")} onClick={() => install(tool.id)} disabled={tool.install_kind === "custom"}><HardDrive size={16} /></IconButton>
                  <IconButton title={t("cliTools.test")} onClick={() => test(tool.id)}><Play size={16} /></IconButton>
                </div>
              </article>
            );
          })}
        </div>
      </Section>
      <Section title={t("cliTools.envProfiles")} icon={<KeyRound size={18} />} actions={<IconButton title={t("common.refresh")} onClick={profiles.refresh}><RefreshCw size={16} /></IconButton>}>
        <form className="inline-form" onSubmit={saveProfile}>
          <input placeholder={t("cliTools.profileName")} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          <select value={profile.tool_id} onChange={(e) => setProfile({ ...profile, tool_id: e.target.value })}>
            {tools.data.items.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
          </select>
          <textarea className="code-editor small" value={envText} onChange={(e) => setEnvText(e.target.value)} />
          <button className="primary-btn" type="submit"><Save size={16} />{t("common.save")}</button>
        </form>
        <div className="row-list">
          {profiles.data.items.map((item) => (
            <div className="row-item" key={item.id}>
              <div><strong>{item.name}</strong><span>{item.tool_id} · {Object.keys(item.env || {}).join(", ") || "-"}</span></div>
              <small>{fmtTime(item.updated_at)}</small>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
