import { useEffect, useState } from "react";
import { loadOvenDefinition } from "@lib/oven-definition.mjs";
import type { OvenIr } from "@/oven/runtime/oven-reducer";

export type ResolvedOvenIr = OvenIr & { id: string; refreshSeconds?: number; root: NonNullable<OvenIr["root"]> };
type LoadState = { key: string; ir: ResolvedOvenIr | null; error: string };

export function useOvenDefinition(id: string, repoKey: string | null) {
  const key = `${repoKey ?? "global"}:${id}`;
  const [state, setState] = useState<LoadState | null>(null);
  const current = state?.key === key ? state : null;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const ir = await loadOvenDefinition({ id, repoKey, signal: controller.signal }) as ResolvedOvenIr;
        if (!controller.signal.aborted) setState({ key, ir, error: "" });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setState({ key, ir: null, error: cause instanceof Error ? cause.message : `Could not load Oven ${id}.` });
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [id, key, repoKey]);

  return { ir: current?.ir ?? null, error: current?.error ?? "", loading: current === null };
}
