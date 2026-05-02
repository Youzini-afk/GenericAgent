import { Edit2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { T } from "../lib/i18n";
import { useAsyncData } from "../hooks";
import { api } from "../api";

type ConfigItem = { var: string; kind: string; data: Record<string, unknown> };
type LlmConfig = { configs: ConfigItem[]; extras: Record<string, unknown>; path: string };

// ── Tab definitions ──────────────────────────────────────
const TABS = [
  { id: "claude",  label: "Claude Code", kinds: ["claude"],        color: "#D4915D", initials: "CC" },
  { id: "oai",     label: "Codex / OAI", kinds: ["oai"],           color: "#10A37F", initials: "OA" },
  { id: "native",  label: "Native",      kinds: ["native_claude", "native_oai"], color: "#7C6AF7", initials: "NA" },
  { id: "custom",  label: "Custom",      kinds: ["mixin", "unknown"],             color: "#6B7280", initials: "CU" },
] as const;
type TabId = typeof TABS[number]["id"];

function tabForKind(kind: string): TabId {
  for (const tab of TABS) {
    if ((tab.kinds as readonly string[]).includes(kind)) return tab.id;
  }
  return "custom";
}

// ── Presets per tab ──────────────────────────────────────
const PRESETS: Record<TabId, Array<{ label: string; var: string; kind: string; data: Record<string, unknown> }>> = {
  claude: [
    { label: "Anthropic Official", var: "CLAUDE_API", kind: "claude", data: { apikey: "", apibase: "https://api.anthropic.com", model: "claude-opus-4-5" } },
    { label: "Custom Endpoint",    var: "CLAUDE_CUSTOM", kind: "claude", data: { apikey: "", apibase: "", model: "claude-opus-4-5" } },
  ],
  oai: [
    { label: "OpenAI Official",    var: "OAI_API",    kind: "oai", data: { apikey: "", apibase: "https://api.openai.com/v1", model: "gpt-4o" } },
    { label: "Custom OAI-compat",  var: "OAI_CUSTOM", kind: "oai", data: { apikey: "", apibase: "", model: "" } },
  ],
  native: [
    { label: "Native Claude",      var: "NATIVE_CLAUDE", kind: "native_claude", data: { apikey: "", apibase: "https://api.anthropic.com", model: "claude-opus-4-5" } },
    { label: "Native OAI",         var: "NATIVE_OAI",   kind: "native_oai",    data: { apikey: "", apibase: "https://api.openai.com/v1", model: "gpt-4o" } },
  ],
  custom: [
    { label: "Mixin",  var: "MIXIN_API",  kind: "mixin",   data: {} },
    { label: "Blank",  var: "CUSTOM_API", kind: "unknown", data: {} },
  ],
};

// ── Avatar ───────────────────────────────────────────────
function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.slice(0, 2).toUpperCase() || "??";
  return (
    <div className="cfg-avatar" style={{ background: color + "33", color }}>
      {initials}
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────
function ProviderCard({ item, tabColor, onEdit, onDelete }: {
  item: ConfigItem; tabColor: string; onEdit: () => void; onDelete: () => void;
}) {
  const apibase = item.data.apibase != null ? String(item.data.apibase) : "";
  const model   = item.data.model   != null ? String(item.data.model)   : "";
  return (
    <div className="cfg-provider-card">
      <Avatar name={item.var} color={tabColor} />
      <div className="cfg-provider-info">
        <span className="cfg-provider-name">{item.var}</span>
        {apibase && <span className="cfg-provider-url">{apibase}</span>}
        {model   && <span className="cfg-provider-model">{model}</span>}
      </div>
      <div className="cfg-provider-actions">
        <button type="button" className="icon-btn-ghost" title="Edit" onClick={onEdit}><Edit2 size={13} /></button>
        <button type="button" className="icon-btn-ghost danger" title="Delete" onClick={onDelete}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

// ── Edit drawer ───────────────────────────────────────────
function EditDrawer({ item, onSave, onClose }: {
  item: ConfigItem; onSave: (item: ConfigItem) => void; onClose: () => void;
}) {
  const [varName, setVarName] = useState(item.var);
  const [apiKey,  setApiKey]  = useState(String(item.data.apikey  ?? ""));
  const [apiBase, setApiBase] = useState(String(item.data.apibase ?? ""));
  const [model,   setModel]   = useState(String(item.data.model   ?? ""));
  const [raw,     setRaw]     = useState(JSON.stringify(item.data, null, 2));
  const [showRaw, setShowRaw] = useState(false);

  function handleSave() {
    let data: Record<string, unknown>;
    if (showRaw) {
      try { data = JSON.parse(raw); } catch { toast.error("Invalid JSON"); return; }
    } else {
      data = { ...item.data, apikey: apiKey, apibase: apiBase, model };
    }
    onSave({ var: varName.trim(), kind: item.kind, data });
  }

  return (
    <div className="cfg-drawer-overlay" onClick={onClose}>
      <div className="cfg-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cfg-drawer-header">
          <span className="cfg-drawer-title">{varName || "Edit Config"}</span>
          <button type="button" className="icon-btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="cfg-drawer-body">
          <label className="cfg-field"><span>Variable name</span>
            <input value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="MY_API_CONFIG" />
          </label>
          {!showRaw && <>
            <label className="cfg-field"><span>API Key</span>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </label>
            <label className="cfg-field"><span>API Base URL</span>
              <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.anthropic.com" />
            </label>
            <label className="cfg-field"><span>Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-5" />
            </label>
          </>}
          {showRaw && <label className="cfg-field"><span>Raw JSON</span>
            <textarea className="code-editor small" value={raw} onChange={(e) => setRaw(e.target.value)} />
          </label>}
          <button type="button" className="cfg-toggle-raw" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "← Form view" : "{ } Raw JSON"}
          </button>
        </div>
        <div className="cfg-drawer-footer">
          <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Preset picker modal ───────────────────────────────────
function PresetModal({ tabId, onPick, onClose }: {
  tabId: TabId; onPick: (p: { label: string; var: string; kind: string; data: Record<string, unknown> }) => void; onClose: () => void;
}) {
  const tab = TABS.find((t) => t.id === tabId)!;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ width: "min(400px,100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add {tab.label} Config</span>
          <button type="button" className="icon-btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body" style={{ gap: 6 }}>
          {PRESETS[tabId].map((p) => (
            <button key={p.label} type="button" className="cfg-preset-row" onClick={() => onPick(p)}>
              <Avatar name={p.var || p.label} color={tab.color} />
              <div style={{ flex: 1, textAlign: "left" }}>
                <div className="cfg-preset-label">{p.label}</div>
                {p.data.apibase != null && <div className="cfg-preset-url">{String(p.data.apibase)}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────
export function ConfigPage({ token, t }: { token: string; t: T }) {
  const config = useAsyncData<LlmConfig>(token, "/api/config/llm", { configs: [], extras: {}, path: "" });
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("claude");
  const [editing, setEditing] = useState<number | null>(null);
  const [showPreset, setShowPreset] = useState(false);

  useEffect(() => { setConfigs(config.data.configs); }, [config.data.configs]);

  async function persist(items: ConfigItem[]) {
    await api("/api/config/llm", token, {
      method: "PUT",
      body: JSON.stringify({ configs: items, extras: config.data.extras || {} }),
    });
    await api("/api/runtime/reload", token, { method: "POST" });
    toast.success(t("config.saved"));
    await config.refresh();
  }

  function handleSave(idx: number, item: ConfigItem) {
    const next = configs.map((c, i) => (i === idx ? item : c));
    setConfigs(next); persist(next); setEditing(null);
  }

  function handleDelete(idx: number) {
    const next = configs.filter((_, i) => i !== idx);
    setConfigs(next); persist(next);
    if (editing === idx) setEditing(null);
  }

  function handlePreset(p: { label: string; var: string; kind: string; data: Record<string, unknown> }) {
    const item: ConfigItem = { var: p.var, kind: p.kind, data: { ...p.data } };
    const next = [...configs, item];
    setConfigs(next);
    setEditing(next.length - 1);
    setShowPreset(false);
  }

  const tab = TABS.find((t) => t.id === activeTab)!;
  const tabItems = configs
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => tabForKind(c.kind) === activeTab);

  return (
    <div className="cfg-page">
      {/* Agent tabs */}
      <div className="cfg-tabs">
        {TABS.map((tb) => {
          const count = configs.filter((c) => tabForKind(c.kind) === tb.id).length;
          return (
            <button
              key={tb.id}
              type="button"
              className="cfg-tab"
              data-active={activeTab === tb.id ? "true" : "false"}
              onClick={() => setActiveTab(tb.id)}
            >
              <span className="cfg-tab-dot" style={{ background: tb.color }} />
              {tb.label}
              {count > 0 && <span className="cfg-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Provider list */}
      <div className="cfg-providers">
        <div className="cfg-providers-header">
          <span className="cfg-providers-title" style={{ color: tab.color }}>{tab.label}</span>
          <button type="button" className="create-run-btn" onClick={() => setShowPreset(true)}>
            <Plus size={13} /> Add
          </button>
        </div>

        <div className="cfg-providers-list">
          {tabItems.length === 0 && (
            <div className="empty-state">No {tab.label} configs — click Add</div>
          )}
          {tabItems.map(({ c, i }) => (
            <ProviderCard key={i} item={c} tabColor={tab.color}
              onEdit={() => setEditing(i)}
              onDelete={() => handleDelete(i)} />
          ))}
        </div>

        <div className="cfg-providers-footer">
          <span style={{ fontSize: 11, color: "var(--color-muted-foreground)" }}>{config.data.path}</span>
        </div>
      </div>

      {editing !== null && configs[editing] && (
        <EditDrawer item={configs[editing]} onSave={(item) => handleSave(editing, item)} onClose={() => setEditing(null)} />
      )}
      {showPreset && <PresetModal tabId={activeTab} onPick={handlePreset} onClose={() => setShowPreset(false)} />}
    </div>
  );
}
