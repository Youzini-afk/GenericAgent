import { useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { T } from "../../lib/i18n";
import type { CliRun, CliRunEvent } from "../../lib/types";
import { asText, changedCount, orchestrationMeta, statusLabel, cliStatusClass } from "../../lib/utils";
import { DiffViewer } from "../common/DiffViewer";
import { StatusIcon } from "../common/StatusIcon";

function RunDetail({ run, events, diff, result, t }: {
  run: CliRun; events: CliRunEvent[]; diff: string; result: Record<string, unknown>; t: T;
}) {
  const meta = orchestrationMeta(run);
  return (
    <Tabs.Root defaultValue="events" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs.List style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        {["events", "diff", "result"].map((tab) => (
          <Tabs.Trigger key={tab} value={tab} style={{
            padding: "6px 12px", fontSize: 12, background: "transparent", border: 0,
            borderBottom: "2px solid transparent", cursor: "pointer", color: "var(--color-muted-foreground)"
          }}
            data-state-active-style={{ borderBottomColor: "var(--color-foreground)", color: "var(--color-foreground)" }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Tabs.Content value="events" style={{ padding: 8 }}>
          <pre style={{ fontSize: 11, lineHeight: 1.5, margin: 0 }}>
            {events.map((e) => `[${e.type}] ${asText(e.payload.text || e.payload.status || e.payload.error)}\n`).join("")}
          </pre>
        </Tabs.Content>
        <Tabs.Content value="diff">
          <DiffViewer content={diff} />
        </Tabs.Content>
        <Tabs.Content value="result" style={{ padding: 8 }}>
          {result.summary != null && <div style={{ marginBottom: 8, fontSize: 13 }}>{String(result.summary as string)}</div>}
          {Array.isArray(result.changed_files) && result.changed_files.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--color-muted-foreground)", marginBottom: 4 }}>Changed files ({changedCount(result)})</div>
              {(result.changed_files as string[]).map((f, i) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace" }}>{f}</div>)}
            </div>
          )}
          {Array.isArray(result.blockers) && result.blockers.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--color-destructive)", marginBottom: 4 }}>Blockers</div>
              {(result.blockers as string[]).map((b, i) => <div key={i} style={{ fontSize: 12, color: "var(--color-destructive)" }}>{b}</div>)}
            </div>
          )}
          <pre style={{ fontSize: 11, margin: 0 }}>{asText(result)}</pre>
        </Tabs.Content>
      </div>
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <StatusIcon status={run.status} size={10} />
          <span style={{ fontSize: 12, color: "var(--color-muted-foreground)" }}>{run.provider} · {meta.mode || "-"}</span>
          <span className={cliStatusClass[run.status]} style={{ marginLeft: "auto" }}>{statusLabel(t, run.status)}</span>
        </div>
      </div>
    </Tabs.Root>
  );
}

export function AuxPanel({ t, runDetail }: {
  t: T;
  runDetail?: { run: CliRun; events: CliRunEvent[]; diff: string; result: Record<string, unknown> };
}) {
  return (
    <aside style={{
      width: 340, minWidth: 280, display: "flex", flexDirection: "column",
      background: "var(--color-card)", borderLeft: "1px solid var(--color-border)",
      flexShrink: 0, overflow: "hidden"
    }}>
      <div style={{
        height: 36, display: "flex", alignItems: "center", padding: "0 12px",
        borderBottom: "1px solid var(--color-border)", fontSize: 12,
        color: "var(--color-muted-foreground)", fontWeight: 600, flexShrink: 0
      }}>
        {runDetail ? `Run ${runDetail.run.id.slice(0, 8)}` : t("common.summary")}
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {runDetail
          ? <RunDetail run={runDetail.run} events={runDetail.events} diff={runDetail.diff} result={runDetail.result} t={t} />
          : <div className="empty">{t("agentRuns.selectRun")}</div>
        }
      </div>
    </aside>
  );
}
