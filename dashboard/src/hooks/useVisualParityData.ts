import { useEffect, useRef, useState } from "react";
import { ovenRepoKey, type VisualParityPayload } from "@lib";

export function useVisualParityData() {
  const [payload, setPayload] = useState<VisualParityPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const repoKey = ovenRepoKey();
        const query = repoKey ? `?repoKey=${encodeURIComponent(repoKey)}` : "";
        const response = await fetch(`/api/oven-data/visual-parity${query}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load Visual Parity.");
        if (data.validated !== true) throw new Error("Visual Parity data was not validated by the Oven.");
        if (!cancelled) {
          setPayload(data.payload);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Visual Parity.");
      } finally {
        inFlight.current = false;
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { payload, error, loading };
}
