import type { ReactNode } from "react";

type KpiItemProps = {
  className?: string;
  title?: string;
  visual?: ReactNode;
  heading: ReactNode;
  value: ReactNode;
};

export function KpiItem({ className, title, visual, heading, value }: KpiItemProps) {
  return <div className={className} title={title}>{visual}<div className="driving-parity-kpi-text"><div className="driving-parity-kpi-heading">{heading}</div><div className="driving-parity-kpi-ratio">{value}</div></div></div>;
}
