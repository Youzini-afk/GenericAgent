import type { T } from "../../lib/i18n";

export function DiffViewer({ content, t }: { content: string; t: T }) {
  if (!content) return <div className="empty">{t("diff.noDiff")}</div>;
  return (
    <pre style={{ fontSize: 12, lineHeight: 1.6, margin: 0, overflow: "auto" }}>
      {content.split("\n").map((line, i) => {
        const color = line.startsWith("+") ? "oklch(0.5 0.15 145)" : line.startsWith("-") ? "var(--color-destructive)" : line.startsWith("@@") ? "oklch(0.7 0.15 220)" : "var(--color-muted-foreground)";
        const bg = line.startsWith("+") ? "oklch(0.5 0.15 145 / 10%)" : line.startsWith("-") ? "oklch(0.704 0.191 22.216 / 10%)" : "transparent";
        return (
          <div key={i} style={{ color, background: bg, paddingLeft: 8, minHeight: "1.4em" }}>
            <span style={{ color: "var(--color-muted-foreground)", userSelect: "none", marginRight: 12, fontSize: 11 }}>{i + 1}</span>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
