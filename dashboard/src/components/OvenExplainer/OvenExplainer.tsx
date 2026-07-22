import { useEffect, useState, type ComponentProps } from "react";
import {
  buildOvenCatalog,
  effectiveOvensForRepo,
  ovenExplainerSelection,
  ovenSamplePayloadForEntry,
} from "@lib";
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
  inputContract: string;
  renderContract: string;
  description: string;
  builtIn: boolean;
  origin: "official" | "vendored" | "custom";
  repoKey: string | null;
  ovenRevision: string;
  dataInput: "json-payload" | "producer-managed";
  label: string;
  href: string;
  agentInstructions: string;
};
type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];
type LoadedOven = { entry: OvenCatalogEntry; ir: OvenIr | null; sample: unknown | null };

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
        const inventory = buildOvenCatalog(catalogBody.ovens) as OvenCatalogEntry[];
        const resolved = selection.repoKey
          ? (effectiveOvensForRepo(inventory, selection.repoKey) as OvenCatalogEntry[])
            .find((candidate) => candidate.id === selection.ovenId)
          : inventory.find((candidate) => candidate.id === selection.ovenId && candidate.origin === "official");
        if (!resolved) throw new Error("This Oven could not be found.");
        const entry = resolved.origin === "official" && selection.repoKey
          ? { ...resolved, repoKey: selection.repoKey }
          : resolved;
        const sample = ovenSamplePayloadForEntry(entry, inventory);

        const query = entry.repoKey ? `?repoKey=${encodeURIComponent(entry.repoKey)}` : "";
        try {
          const ovenResponse = await fetch(`/api/ovens/${encodeURIComponent(selection.ovenId)}${query}`, { cache: "no-store", signal: controller.signal });
          if (!ovenResponse.ok) throw new Error(`Could not load Oven (${ovenResponse.status}).`);
          const ovenBody = await ovenResponse.json() as { oven?: { ir?: OvenIr } };
          if (controller.signal.aborted) return;
          setLoaded({ entry, ir: ovenBody.oven?.ir ?? null, sample });
        } catch {
          if (controller.signal.aborted) return;
          setLoaded({ entry, ir: null, sample: null });
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
  if (!loaded.ir) return <OvenExplainerView entry={loaded.entry} ir={{ contract: loaded.entry.renderContract, controls: [], collections: [], root: [] }} sample={null} />;
  return <OvenExplainerView entry={loaded.entry} ir={loaded.ir} sample={loaded.sample} />;
}
