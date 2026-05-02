import { Plus, Settings2, Trash2, X, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { T } from "../lib/i18n";
import { useAsyncData } from "../hooks";
import { api } from "../api";

type ConfigItem = { var: string; kind: string; data: Record<string, unknown> };
type LlmConfig = { configs: ConfigItem[]; extras: Record<string, unknown>; path: string };

const KIND_LABELS: Record<string, string> = {
  claude: "Claude", oai: "OpenAI", native_claude: "Native Claude",
  native_oai: "Native OAI", mixin: "Mixin", unknown: "Custom",
};

const PRESETS: Array<{ label: string; var: string; kind: string; data: Record<string, unknown> }> = [
  { label: "Claude Code", var: "CLAUDE_API", kind: "claude", data: { apikey: "", apibase: "https://api.anthropic.com", model: "claude-opus-4-5" } },
  { label: "OpenAI / Codex", var: "OAI_API", kind: "oai", data: { apikey: "", apibase: "https://api.openai.com/v1", model: "gpt-4o" } },
  { label: "OpenAI-compat (custom)", var: "CUSTOM_OAI", kind: "oai", data: { apikey: "", apibase: "", model: "" } },
  { label: "Native Claude", var: "NATIVE_CLAUDE_API", kind: "native_claude", data: { apikey: "", apibase: "https://api.anthropic.com", model: "claude-opus-4-5" } },
  { label: "Native OAI", var: "NATIVE_OAI_API", kind: "native_oai", data: { apikey: "", apibase: "https://api.openai.com/v1", model: "gpt-4o" } },
  { label: "Blank", var: "", kind: "unknown", data: {} },
];

function kindColor(kind: string) {
  if (kind === "claude" || kind === "native_claude") return "oklch(0.7 0.15 280)";
  if (kind === "oai" || kind === "native_oai") return "oklch(0.7 0.15 145)";
  if (kind === "mixin") return "oklch(0.75 0.15 60)";
  return "var(--color-muted-foreground)";
}

function ConfigCard({ item, active, onClick, onDelete }: {
  item: ConfigItem; active: boolean; onClick: () => void; onDelete: () => void;
}) {
  return (
    <button
      type="button"
      className="cfg-card"
      data-active={active ? "true" : "false"}
      onClick={onClick}
    >
      <div className="cfg-card-top">
        <span className="cfg-card-var">{item.var}</span>
        <span className="cfg-card-kind" style={{ color: kindColor(item.kind) }}>
          {KIND_LABELS[item.kind] ?? item.kind}
        </span>
      </div>
      {item.data.model != null && <div className="cfg-card-model">{String(item.data.model)}</div>}
      {item.data.apibase != null && <div className="cfg-card-base">{String(item.data.apibase)}</div>}
      <div className="cfg-card-actions">
        <button type="button" className="icon-btn-ghost danger" title="Delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={13} />
        </button>
        <ChevronRight size={13} style={{ color: "var(--color-muted-foreground)", marginLeft: "auto" }} />
      </div>
    </button>
  );
}

function EditPanel({ item, onSave, onClose, t }: {
  item: ConfigItem; onSave: (item: ConfigItem) => void; onClose: () => void; t: T;
}) {
  const [varName, setVarName] = useState(item.var);
  const [apiKey, setApiKey] = useState(String(item.data.apikey ?? ""));
  const [apiBase, setApiBase] = useState(String(item.data.apibase ?? ""));
  const [model, setModel] = useState(String(item.data.model ?? ""));
  const [rawJson, setRawJson] = useState(JSON.stringify(item.data, null, 2));
  const [showRaw, setShowRaw] = useState(false);

  function handleSave() {
    let data: Record<string, unknown>;
    if (showRaw) {
      try { data = JSON.parse(rawJson); } catch { toast.error("Invalid JSON"); return; }
    } else {
      data = { ...item.data };
      if (apiKey) data.apikey = apiKey;
      if (apiBase) data.apibase = apiBase;
      if (model) data.model = model;
    }
    onSave({ var: varName.trim(), kind: item.kind, data });
  }

  return (
    <div className="cfg-panel">
      <div className="cfg-panel-header">
        <span className="cfg-panel-title">{varName || t("config.edit")}</span>
        <button type="button" className="icon-btn-ghost" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="cfg-panel-body">
        <label className="cfg-field">
          <span>{t("config.varName")}</span>
          <input value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="MY_API_CONFIG" />
        </label>
        {!showRaw && (
          <>
            <label className="cfg-field">
              <span>{t("config.apiKey")}</span>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </label>
            <label className="cfg-field">
              <span>{t("config.apiBase")}</span>
              <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.anthropic.com" />
            </label>
            <label className="cfg-field">
              <span>{t("config.model")}</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-5" />
            </label>
          </>
        )}
        {showRaw && (
          <label className="cfg-field">
            <span>{t("config.rawJson")}</span>
            <textarea className="code-editor small" value={rawJson} onChange={(e) => setRawJson(e.target.value)} />
          </label>
        )}
        <button type="button" className="cfg-toggle-raw" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? "← 表单视图" : "{ } 原始 JSON"}
        </button>
      </div>
      <div className="cfg-panel-footer">
        <button type="button" className="ghost-btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="primary-btn" onClick={handleSave}>{t("common.save")}</button>
      </div>
    </div>
  );
}

function PresetPicker({ onPick, onClose }: { onPick: (p: typeof PRESETS[0]) => void; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ width: "min(420px,100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">从预设创建</span>
          <button type="button" className="icon-btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body" style={{ gap: 6 }}>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="cfg-preset-row" onClick={() => onPick(p)}>
              <span className="cfg-preset-label">{p.label}</span>
              <span className="cfg-preset-kind" style={{ color: kindColor(p.kind) }}>{KIND_LABELS[p.kind] ?? p.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConfigPage({ token, t }: { token: string; t: T }) {
  const config = useAsyncData<LlmConfig>(token, "/api/config/llm", { configs: [], extras: {}, path: "" });
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showPreset, setShowPreset] = useState(false);

  useEffect(() => { setConfigs(config.data.configs); }, [config.data.configs]);

  async function save(items: ConfigItem[]) {
    await api("/api/config/llm", token, {
      method: "PUT",
      body: JSON.stringify({ configs: items, extras: config.data.extras || {} }),
    });
    await api("/api/runtime/reload", token, { method: "POST" });
    toast.success(t("config.saved"));
    await config.refresh();
  }

  function handleSaveItem(idx: number, item: ConfigItem) {
    const next = configs.map((c, i) => (i === idx ? item : c));
    setConfigs(next);
    save(next);
    setSelected(null);
  }

  function handleDelete(idx: number) {
    const next = configs.filter((_, i) => i !== idx);
    setConfigs(next);
    save(next);
    if (selected === idx) setSelected(null);
  }

  function handlePreset(p: typeof PRESETS[0]) {
    const item: ConfigItem = { var: p.var, kind: p.kind, data: { ...p.data } };
    const next = [...configs, item];
    setConfigs(next);
    setSelected(next.length - 1);
    setShowPreset(false);
  }

  const editItem = selected !== null ? configs[selected] : null;

  return (
    <div className="cfg-layout">
      <div className="cfg-list-pane">
        <div className="cfg-list-header">
          <span className="cfg-list-title">{t("nav.config")}</span>
          <button type="button" className="icon-btn-ghost" title={t("config.add")} onClick={() => setShowPreset(true)}>
            <Plus size={15} />
          </button>
        </div>
        <div className="cfg-list">
          {configs.length === 0 && (
            <div className="empty-state">{t("config.noConfigs")}</div>
          )}
          {configs.map((item, i) => (
            <ConfigCard key={i} item={item} active={selected === i}
              onClick={() => setSelected(i === selected ? null : i)}
              onDelete={() => handleDelete(i)} />
          ))}
        </div>
        <div className="cfg-list-footer">
          <span style={{ fontSize: 11, color: "var(--color-muted-foreground)" }}>{config.data.path}</span>
        </div>
      </div>

      {editItem !== null && selected !== null && (
        <EditPanel item={editItem} t={t}
          onSave={(item) => handleSaveItem(selected, item)}
          onClose={() => setSelected(null)} />
      )}

      {!editItem && (
        <div className="empty-state centered" style={{ flex: 1 }}>
          <Settings2 size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
          <span>{configs.length === 0 ? t("config.noConfigs") : "选择一个配置进行编辑"}</span>
        </div>
      )}

      {showPreset && <PresetPicker onPick={handlePreset} onClose={() => setShowPreset(false)} />}
    </div>
  );
}
