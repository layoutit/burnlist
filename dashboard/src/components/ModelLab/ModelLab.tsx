import { useEffect, useState, type ComponentProps } from "react";
import { ovenRepoKey } from "@lib";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import type { ModelLabPayload } from "@/oven/ModelLabView";

type ModelLabIr = ComponentProps<typeof OvenRuntime>["ir"];

export const MODEL_LAB_POLL_MS = 2_000;

export function modelLabDataUrl(repoKey: string | null) {
  return `/api/oven-data/model-lab${repoKey ? `?repoKey=${encodeURIComponent(repoKey)}` : ""}`;
}

export function ModelLabPageContent({ error, ir, loading, payload }: {
  error: string;
  ir: ModelLabIr;
  loading: boolean;
  payload: ModelLabPayload | null;
}) {
  if (loading && !payload) {
    return <div className="model-lab-oven-state">Loading the bound Model Lab surface…</div>;
  }
  if (error && !payload) {
    return <div className="model-lab-oven-state is-error">{error}</div>;
  }
  if (!payload) return null;
  return <OvenRuntime ir={ir} payload={payload} />;
}

export function ModelLabPage({ ir }: { ir: ModelLabIr }) {
  const [payload, setPayload] = useState<ModelLabPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(modelLabDataUrl(ovenRepoKey()), { cache: "no-store" });
        const document = await response.json();
        if (!response.ok) throw new Error(document.error ?? "Could not load Model Lab.");
        if (document.validated !== true) throw new Error("Model Lab data was not validated by the Oven.");
        if (!cancelled) {
          setPayload(document.payload);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Model Lab.");
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, MODEL_LAB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return <ModelLabPageContent error={error} ir={ir} loading={loading} payload={payload} />;
}
