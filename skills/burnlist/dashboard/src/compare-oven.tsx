import { useEffect, useRef, useState } from "react";
// @ts-expect-error The source-compatible renderer is plain ESM so the fallback route can use it too.
import { COMPARE_REFRESH_MS, mountCompareDashboard } from "../fallback-compare-oven.js";

type ComparePayload = {
  generatedAt: string;
  summary: {
    fields: { total: number; passed: number; failed: number; blocked: number };
    frames: { total: number; passed: number; failed: number; blocked: number };
  };
  progress: unknown[];
  log: unknown[];
  fields: unknown[];
};

type CompareOven = {
  detail: {
    cells: Array<{ id: string; title: string }>;
  };
};

type MountedDashboard = {
  update: (oven: CompareOven, payload: ComparePayload) => void;
};

export function CompareOvenPage() {
  const [payload, setPayload] = useState<ComparePayload | null>(null);
  const [oven, setOven] = useState<CompareOven | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.classList.add("compare-oven-body");
    return () => document.body.classList.remove("compare-oven-body");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshInFlight = false;
    let refreshQueued = false;
    let payloadRevision = "";
    const load = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        const [ovenResponse, dataResponse] = await Promise.all([
          fetch("/api/ovens/compare", { cache: "no-store" }),
          fetch("/api/oven-data/compare", { cache: "no-store" }),
        ]);
        const ovenJson = await ovenResponse.json();
        const dataJson = await dataResponse.json();
        if (!ovenResponse.ok) throw new Error(ovenJson.error ?? "Could not load Compare Oven.");
        if (!dataResponse.ok) throw new Error(dataJson.error ?? "Could not load Compare data.");
        if (cancelled) return;
        const nextRevision = String(dataJson.payload?.generatedAt ?? "");
        if (!payloadRevision || nextRevision !== payloadRevision) {
          setOven(ovenJson.oven);
          setPayload(dataJson.payload);
          payloadRevision = nextRevision;
        }
        setError("");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Compare dashboard.");
      } finally {
        refreshInFlight = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void load();
        }
      }
    };
    void load();
    const timer = window.setInterval(load, COMPARE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="compare-oven-page">
      {error
        ? <div className="compare-error">{error}</div>
        : oven && payload
          ? <SharedParityDashboard oven={oven} payload={payload} />
          : <div className="compare-empty">Loading Compare Oven.</div>}
    </div>
  );
}

function SharedParityDashboard({ oven, payload }: { oven: CompareOven; payload: ComparePayload }) {
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedDashboard | null>(null);

  useEffect(() => {
    if (!root.current) return;
    if (!mounted.current) mounted.current = mountCompareDashboard(root.current, oven, payload);
    else mounted.current.update(oven, payload);
  }, [oven, payload]);

  return <div ref={root} />;
}
