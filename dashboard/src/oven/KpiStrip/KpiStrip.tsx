import type { ReactNode } from "react";

type KpiStripProps = {
  className?: string;
  ariaLabel?: string;
  id?: string;
  children?: ReactNode;
};

export function KpiStrip({ className, ariaLabel, id, children }: KpiStripProps) {
  return <div aria-label={ariaLabel} className={className} id={id}>{children}</div>;
}
