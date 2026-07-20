import { useEffect, useState, type ComponentProps } from "react";
import { customOvenSelection } from "@lib";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { DashboardError } from "../DashboardError";
import { EmptyState } from "../EmptyState";

type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];
type LoadedOven = { ir: OvenIr; payload: unknown };

function unwrapPayload(raw: unknown) {
  return raw && typeof raw === "object" && "payload" in raw ? (raw as { payload: unknown }).payload : raw;
}

export function CustomOvenView() {
  const selection = customOvenSelection();
  const [loaded, setLoaded] = useState<LoadedOven | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selection?.repoKey) {
      setLoaded(null);
      setError("This custom Oven requires a repository key.");
      return;
    }
    const controller = new AbortController();
    const query = `?repoKey=${encodeURIComponent(selection.repoKey)}`;
    const load = async () => {
      setLoaded(null);
      setError("");
      try {
        const [ovenResponse, dataResponse] = await Promise.all([
          fetch(`/api/ovens/${selection.id}${query}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/oven-data/${selection.id}${query}`, { cache: "no-store", signal: controller.signal }),
        ]);
        if (!ovenResponse.ok) throw new Error(`Could not load Oven (${ovenResponse.status}).`);
        if (!dataResponse.ok) throw new Error(`Could not load Oven data (${dataResponse.status}).`);
        const [ovenBody, dataBody] = await Promise.all([ovenResponse.json(), dataResponse.json()]);
        if (controller.signal.aborted) return;
        setLoaded({ ir: ovenBody.oven.ir, payload: dataBody.payload });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load the custom Oven.");
      }
    };
    void load();
    return () => controller.abort();
  }, [selection?.id, selection?.repoKey]);

  if (error) return <DashboardError message={error} />;
  if (!loaded) return <EmptyState title="Loading Oven" detail="Reading the Oven view and its bound data." />;
  return <OvenRuntime ir={loaded.ir} payload={loaded.payload} adapt={unwrapPayload} />;
}
