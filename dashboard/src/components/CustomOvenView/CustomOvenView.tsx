import type { ComponentProps } from "react";
import { customOvenSelection } from "@lib";
import { adaptChecklist } from "@lib/checklist-adapter";
import type { ProgressData } from "@lib";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { DashboardError } from "../DashboardError";
import { EmptyState } from "../EmptyState";
import { LensSwitcher } from "../LensSwitcher";
import { OvenDefinition } from "../OvenDefinition";

type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];

function unwrapPayload(raw: unknown) {
  return raw && typeof raw === "object" && "payload" in raw ? (raw as { payload: unknown }).payload : raw;
}

export function CustomOvenRuntime({ burnlistId, ir, payload }: { burnlistId?: string; ir: OvenIr; payload?: unknown }) {
  if (burnlistId) {
    return <><LensSwitcher /><OvenRuntime ir={{ ...ir, refreshSeconds: undefined }} payload={payload} /></>;
  }
  return <OvenRuntime ir={ir} adapt={unwrapPayload} />;
}

export function CustomOvenView({ error, loading, progress, stale }: { error: string; loading: boolean; progress: ProgressData | null; stale: boolean }) {
  const selection = customOvenSelection();
  if (!selection?.repoKey) return <DashboardError message="This custom Oven requires a repository key." />;
  if (selection.burnlistId && loading && !progress) return <EmptyState title="Loading Oven" detail="Reading canonical Burnlist data." />;
  if (selection.burnlistId && !progress) return error ? <DashboardError message={error} /> : <EmptyState title="Loading Oven" detail="Reading canonical Burnlist data." />;
  return <>
    {selection.burnlistId && (error || stale) && <DashboardError floating message={error || "Showing the last canonical Burnlist snapshot while fresh data loads."} />}
    <OvenDefinition id={selection.id} repoKey={selection.repoKey}>{(ir) => (
      <CustomOvenRuntime
        burnlistId={selection.burnlistId ?? undefined}
        ir={ir}
        payload={selection.burnlistId ? adaptChecklist(progress!) : undefined}
      />
    )}</OvenDefinition>
  </>;
}
