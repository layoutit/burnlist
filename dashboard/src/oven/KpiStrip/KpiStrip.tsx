import type { ReactNode } from "react";

type KpiStripProps = {
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
};

export function KpiStrip({ className, ariaLabel, children }: KpiStripProps) {
  return <div aria-label={ariaLabel} className={className}>{children}</div>;
}
