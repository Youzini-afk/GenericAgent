import { Code2, Globe2, HardDrive, Play, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserTab } from "../lib/types";
import type { T } from "../lib/i18n";
import { IconButton, Section } from "../components/ui/primitives";
import { api } from "../api";

export function BrowserPage({ token, t }: { token: string; t: T }) {
  const [workerId, setWorkerId] = useState("worker-1");
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTab, setActiveTab] = useState("p1");
  const [url, setUrl] = useState("https://example.com");
  const [code, setCode] = useState("return document.title;");
  const [result, setResult] = useState("");
  const [screenshot, setScreenshot] = useState("");

  async function loadTabs() {
    const data = await api<{ items: BrowserTab[] }>(`/api/browser/workers/${workerId}/tabs`, token);
    setTabs(data.items);
    if (data.items[0]) setActiveTab(data.items[0].id);
  }

  async function newTab() {
    await api(`/api/browser/workers/${workerId}/tabs`, token, { method: "POST", body: JSON.stringify({ url }) });
    await loadTabs();
  }

  async function navigate() {
    await api(`/api/browser/workers/${workerId}/tabs/${activeTab}/navigate`, token, { method: "POST", body: JSON.stringify({ url }) });
    await loadTabs();
  }

  async function execute() {
    const data = await api<Record<string, unknown>>(`/api/browser/workers/${workerId}/tabs/${activeTab}/execute`, token, { method: "POST", body: JSON.stringify({ code }) });
    setResult(JSON.stringify(data, null, 2));
  }

  async function capture() {
    const data = await api<{ base64: string }>(`/api/browser/workers/${workerId}/tabs/${activeTab}/screenshot`, token);
    setScreenshot(data.base64);
  }

  useEffect(() => { loadTabs().catch(() => undefined); }, [workerId]);

  return (
    <div className="two-column">
      <Section title={t("nav.browser")} icon={<Globe2 size={18} />}>
        <div className="cloud-note">{t("browser.note")}</div>
        <div className="pathbar">
          <input value={workerId} onChange={(e) => setWorkerId(e.target.value)} />
          <IconButton title={t("browser.refreshTabs")} onClick={loadTabs}><RefreshCw size={16} /></IconButton>
        </div>
        <div className="pathbar">
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
          <IconButton title={t("browser.newTab")} onClick={newTab}><Plus size={16} /></IconButton>
          <IconButton title={t("browser.navigate")} onClick={navigate}><Play size={16} /></IconButton>
        </div>
        <div className="row-list">
          {tabs.map((tab) => (
            <button className={`row-item file ${tab.id === activeTab ? "active" : ""}`} key={tab.id} onClick={() => setActiveTab(tab.id)}>
              <strong>{tab.id}</strong><span>{tab.title || tab.url}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("common.execute")} icon={<Code2 size={18} />} actions={<><IconButton title={t("browser.screenshot")} onClick={capture}><HardDrive size={16} /></IconButton><button className="primary-btn" type="button" onClick={execute}><Play size={16} />{t("common.execute")}</button></>}>
        <textarea className="code-editor small" value={code} onChange={(e) => setCode(e.target.value)} />
        <pre className="log-box">{result}</pre>
        {screenshot && <img className="screenshot" src={`data:image/png;base64,${screenshot}`} alt="" />}
      </Section>
    </div>
  );
}
