import type { ReactNode } from "react";

type KpiItemProps = {
  className?: string;
  title?: string;
  visual?: ReactNode;
  heading: ReactNode;
  value: ReactNode;
};

export const checklistKpiItemClassName = "driving-parity-kpi-item driving-parity-kpi-section";

export function KpiItem({ className, title, visual, heading, value }: KpiItemProps) {
  const resolvedClassName = [className, visual == null || visual === false ? "is-visual-free" : ""].filter(Boolean).join(" ") || undefined;
  const resolvedValue = value === null || value === undefined || value === ""
    ? <span aria-label="No value" className="oven-kpi-empty-value">—</span>
    : value === false ? "false" : value;
  return <div className={resolvedClassName} title={title}>{visual}<div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">{heading}</div><div className="driving-parity-kpi-ratio">{resolvedValue}</div></div></div>;
}
