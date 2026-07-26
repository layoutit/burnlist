import { Fragment, type ComponentProps, type ReactNode } from "react";
import { customOvenSelection } from "@lib";
import { adaptChecklist } from "@lib/checklist-adapter";
import type { ProgressData } from "@lib";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { DashboardError } from "../DashboardError";
import { EmptyState } from "../EmptyState";
import { LensSwitcher } from "../LensSwitcher";
import { OvenDefinition } from "../OvenDefinition";
import "./CustomOvenView.css";

type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];

function unwrapPayload(raw: unknown) {
  return raw && typeof raw === "object" && "payload" in raw ? (raw as { payload: unknown }).payload : raw;
}

export function burnlistOvenPayload(progress: ProgressData) {
  return adaptChecklist(progress);
}

function customOvenSurface(children: ReactNode, ovenId?: string) {
  return <section aria-label={`${ovenId ?? "Custom"} Oven`} className="custom-oven-view" data-oven-id={ovenId}>{children}</section>;
}

export function CustomOvenRuntime({ burnlistId, framed = true, ir, payload }: { burnlistId?: string; framed?: boolean; ir: OvenIr; payload?: unknown }) {
  const content = [
    burnlistId ? <LensSwitcher key="lens" /> : null,
    burnlistId
      ? <OvenRuntime ir={{ ...ir, refreshSeconds: undefined }} key="runtime" payload={payload} />
      : <OvenRuntime adapt={unwrapPayload} ir={ir} key="runtime" />,
  ];
  return framed ? customOvenSurface(content, ir.id) : <Fragment>{content}</Fragment>;
}

export function CustomOvenView({ error, loading, progress, stale }: { error: string; loading: boolean; progress: ProgressData | null; stale: boolean }) {
  const selection = customOvenSelection();
  const surface = (content: ReactNode) => customOvenSurface(content, selection?.id);
  if (!selection?.repoKey) return surface(<DashboardError message="This custom Oven requires a repository key." />);
  if (selection.burnlistId && loading && !progress) return surface(<EmptyState title="Loading Oven" detail="Reading canonical Burnlist data." />);
  if (selection.burnlistId && !progress) return surface(error ? <DashboardError message={error} /> : <EmptyState title="Loading Oven" detail="Reading canonical Burnlist data." />);
  return surface(<>
    {selection.burnlistId && (error || stale) && <DashboardError floating message={error || "Showing the last canonical Burnlist snapshot while fresh data loads."} />}
    <OvenDefinition id={selection.id} repoKey={selection.repoKey}>{(ir) => (
      <CustomOvenRuntime
        burnlistId={selection.burnlistId ?? undefined}
        framed={false}
        ir={ir}
        payload={selection.burnlistId ? burnlistOvenPayload(progress!) : undefined}
      />
    )}</OvenDefinition>
  </>);
}
