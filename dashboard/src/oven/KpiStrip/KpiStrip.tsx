import type { ReactNode } from "react";

type KpiStripProps = {
  className?: string;
  ariaLabel?: string;
  id?: string;
  title?: string;
  children?: ReactNode;
};

export const checklistKpiStripClassName = "driving-parity-kpi-strip has-burns checklist-kpi-strip";
export const checklistKpiStripAriaLabel = "Burnlist progress KPIs";

export function KpiStrip({ className, ariaLabel, id, title, children }: KpiStripProps) {
  return <div aria-label={ariaLabel} className={className} id={id} title={title}>{children}</div>;
}
