import { useEffect, useRef, useState } from "react";
// @ts-expect-error The canonical renderer is plain ESM so React and the direct Oven route share one implementation.
import { DIFFERENTIAL_TESTING_REFRESH_MS, differentialPayloadRevision, mountDifferentialTestingDashboard } from "../differential-testing-renderer.js";

type DifferentialTestingPayload = {
  publishedAt: string;
  summary: {
    fields: { total: number; passed: number; failed: number; blocked: number };
    frames: { total: number; passed: number; failed: number; blocked: number };
  };
  progress: unknown[];
  log: unknown[];
  fields: unknown[];
  exactSession?: unknown;
  telemetry?: unknown;
  telemetryGate?: unknown;
};

type DifferentialTestingOven = {
  detail: {
    cells: Array<{ id: string; title: string }>;
  };
};

type MountedDashboard = {
  update: (oven: DifferentialTestingOven, payload: DifferentialTestingPayload) => void;
  destroy?: () => void;
};

export function DifferentialTestingPage() {
  const [payload, setPayload] = useState<DifferentialTestingPayload | null>(null);
  const [oven, setOven] = useState<DifferentialTestingOven | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.classList.add("driving-parity-view");
    return () => document.body.classList.remove("driving-parity-view");
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
          fetch("/api/ovens/differential-testing", { cache: "no-store" }),
          fetch("/api/oven-data/differential-testing", { cache: "no-store" }),
        ]);
        const ovenJson = await ovenResponse.json();
        const dataJson = await dataResponse.json();
        if (!ovenResponse.ok) throw new Error(ovenJson.error ?? "Could not load Differential Testing Oven.");
        if (!dataResponse.ok) throw new Error(dataJson.error ?? "Could not load Differential Testing data.");
        if (cancelled) return;
        const nextRevision = differentialPayloadRevision(dataJson.payload);
        if (!payloadRevision || nextRevision !== payloadRevision) {
          setOven(ovenJson.oven);
          setPayload(dataJson.payload);
          payloadRevision = nextRevision;
        }
        setError("");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Differential Testing dashboard.");
      } finally {
        refreshInFlight = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void load();
        }
      }
    };
    void load();
    const timer = window.setInterval(load, DIFFERENTIAL_TESTING_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <div className="shell driving-parity-view"><div className="empty">{error}</div></div>;
  if (!oven || !payload) return <div className="shell driving-parity-view"><div className="empty">Loading Differential Testing Oven.</div></div>;
  return <SharedDifferentialTestingDashboard oven={oven} payload={payload} />;
}

function SharedDifferentialTestingDashboard({ oven, payload }: { oven: DifferentialTestingOven; payload: DifferentialTestingPayload }) {
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedDashboard | null>(null);

  useEffect(() => {
    if (!root.current) return;
    if (!mounted.current) mounted.current = mountDifferentialTestingDashboard(root.current, oven, payload);
    else mounted.current.update(oven, payload);
  }, [oven, payload]);

  useEffect(() => () => {
    mounted.current?.destroy?.();
    mounted.current = null;
  }, []);

  return <div ref={root} className="shell driving-parity-view" />;
}
