import type { ReactNode } from "react";
import { useOvenDefinition, type ResolvedOvenIr } from "@hooks";
import { DashboardError } from "../DashboardError";
import { EmptyState } from "../EmptyState";

export function OvenDefinition({ children, id, repoKey }: {
  children: (ir: ResolvedOvenIr) => ReactNode;
  id: string;
  repoKey: string | null;
}) {
  const { ir, error } = useOvenDefinition(id, repoKey);
  if (error) return <DashboardError message={error} />;
  if (!ir) return <EmptyState title="Loading Oven" detail="Reading the repository-resolved Oven definition." />;
  return children(ir);
}
