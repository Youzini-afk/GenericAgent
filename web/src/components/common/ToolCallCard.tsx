import { useState, type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";

export function ToolCallCard({
  name,
  status,
  statusLabel,
  input,
  output,
  isError
}: {
  name: string;
  status: string;
  statusLabel: string;
  input?: string;
  output?: string;
  isError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.375rem", overflow: "hidden" }}>
        <Collapsible.Trigger asChild>
          <button
            type="button"
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 12px", background: "var(--color-card)", cursor: "pointer", border: 0
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-foreground)" }}>{name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`badge ${isError ? "bad" : status === "running" ? "live" : status === "succeeded" ? "ok" : "muted"}`}>{statusLabel}</span>
              <ChevronDown size={14} style={{ color: "var(--color-muted-foreground)", transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
            </div>
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div style={{ padding: "0 12px 12px", display: "grid", gap: 8, opacity: open ? 1 : 0, transition: "opacity 150ms" }}>
            {input && (
              <pre style={{ background: "oklch(0.269 0 0 / 50%)", borderRadius: 6, padding: 10, fontSize: 12, margin: 0 }}>{input}</pre>
            )}
            {output && (
              <pre style={{
                background: isError ? "oklch(0.704 0.191 22.216 / 10%)" : "oklch(0.269 0 0 / 50%)",
                color: isError ? "var(--color-destructive)" : "inherit",
                borderRadius: 6, padding: 10, fontSize: 12, margin: 0
              }}>{output}</pre>
            )}
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
