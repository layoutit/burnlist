import { useEffect, useState, type ComponentProps } from "react";
import { buildOvenCatalog, ovenExplainerSelection, ovenSamplePayload } from "@lib";
import type { OvenSummary } from "@lib/types";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { DashboardError } from "../DashboardError";
import { EmptyState } from "../EmptyState";
import { OvenExplainerView } from "./OvenExplainerView";

type OvenCatalogEntry = {
  id: string;
  name: string;
  version: string;
  contract: string;
  description: string;
  builtIn: boolean;
  repoKey: string | null;
  dataInput: "json-payload" | "producer-managed";
  label: string;
  href: string;
  agentInstructions: string;
};
type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];
type LoadedOven = { entry: OvenCatalogEntry; ir: OvenIr | null };

export function OvenExplainer() {
  const selection = ovenExplainerSelection();
  const [loaded, setLoaded] = useState<LoadedOven | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selection) {
      setLoaded(null);
      setError("This Oven explainer requires an Oven identifier.");
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      setLoaded(null);
      setError("");
      try {
        const catalogResponse = await fetch("/api/ovens", { cache: "no-store", signal: controller.signal });
        if (!catalogResponse.ok) throw new Error(`Could not load Ovens (${catalogResponse.status}).`);
        const catalogBody = await catalogResponse.json() as { ovens?: OvenSummary[] };
        if (controller.signal.aborted) return;
        const entry = (buildOvenCatalog(catalogBody.ovens) as OvenCatalogEntry[]).find((candidate) => candidate.id === selection.ovenId
          && candidate.repoKey === selection.repoKey);
        if (!entry) throw new Error("This Oven could not be found.");

        const query = entry.repoKey ? `?repoKey=${encodeURIComponent(entry.repoKey)}` : "";
        try {
          const ovenResponse = await fetch(`/api/ovens/${encodeURIComponent(selection.ovenId)}${query}`, { cache: "no-store", signal: controller.signal });
          if (!ovenResponse.ok) throw new Error(`Could not load Oven (${ovenResponse.status}).`);
          const ovenBody = await ovenResponse.json() as { oven?: { ir?: OvenIr } };
          if (controller.signal.aborted) return;
          setLoaded({ entry, ir: ovenBody.oven?.ir ?? null });
        } catch {
          if (controller.signal.aborted) return;
          setLoaded({ entry, ir: null });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load this Oven.");
      }
    };
    void load();
    return () => controller.abort();
  }, [selection?.ovenId, selection?.repoKey]);

  if (error) return <DashboardError message={error} />;
  if (!loaded) return <EmptyState title="Loading Oven" detail="Reading the Oven definition and explainer details." />;
  if (!loaded.ir) return <OvenExplainerView entry={loaded.entry} ir={{ contract: loaded.entry.contract, controls: [], collections: [], root: [] }} sample={null} />;
  return <OvenExplainerView entry={loaded.entry} ir={loaded.ir} sample={ovenSamplePayload(loaded.entry.id)} />;
}
