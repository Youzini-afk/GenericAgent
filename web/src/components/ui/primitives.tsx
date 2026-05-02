import type { ReactNode } from "react";

export function IconButton({ title, onClick, children, danger, disabled }: {
  title: string; onClick?: () => void; children: ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button className={`icon-btn ${danger ? "danger" : ""}`} type="button" title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Section({ title, icon, actions, children }: {
  title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{icon}{title}</h2>
        <div className="actions">{actions}</div>
      </div>
      {children}
    </section>
  );
}
