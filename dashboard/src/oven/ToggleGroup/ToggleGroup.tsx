import type { ReactNode } from "react";

export type ToggleGroupProps = {
  id: string;
  className: string;
  ariaLabel: string;
  children?: ReactNode;
};

export function ToggleGroup({ id, className, ariaLabel, children }: ToggleGroupProps) {
  return <div id={id} className={className} role="group" aria-label={ariaLabel}>{children}</div>;
}
