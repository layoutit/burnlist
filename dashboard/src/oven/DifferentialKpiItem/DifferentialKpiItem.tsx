import type { ReactNode } from "react";

export type DifferentialKpiItemProps = {
  className?: string;
  title: string;
  visual?: ReactNode;
  heading: ReactNode;
  headingClass?: string;
  value: ReactNode;
  valueClass?: string;
};

export function DifferentialKpiItem({
  className,
  title,
  visual,
  heading,
  headingClass = "",
  value,
  valueClass = "",
}: DifferentialKpiItemProps) {
  const itemClass = `driving-parity-kpi-item${visual ? " driving-parity-kpi-section" : ""}${className ? ` ${className}` : ""}`;
  const headingClassName = `driving-parity-kpi-heading${headingClass ? ` ${headingClass}` : ""}`;
  const valueClassName = `${visual ? "driving-parity-kpi-ratio" : "driving-parity-kpi-title-subtitle"}${valueClass ? ` ${valueClass}` : ""}`;

  return <div className={itemClass} title={title}>
    {visual}
    {visual
      ? <div className="driving-parity-kpi-text"><span className={headingClassName}>{heading}</span><span className={valueClassName}>{value}</span></div>
      : <><span className={headingClassName}>{heading}</span><span className={valueClassName}>{value}</span></>}
  </div>;
}
