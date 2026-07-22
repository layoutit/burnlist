import { useMemo } from "react";
import { useVisualParityData, type ResolvedOvenIr } from "@hooks";
import { adaptVisualParity } from "@lib/visual-parity-oven-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";

export function VisualParityPage({ ir }: { ir: ResolvedOvenIr }) {
  const { payload, error, loading } = useVisualParityData();
  const ovenPayload = useMemo(() => payload ? adaptVisualParity(payload) : null, [payload]);

  if (loading && !payload) return <div className="visual-parity-state">Loading Visual Parity…</div>;
  if (error && !payload) return <div className="visual-parity-state is-error">{error}</div>;
  if (!payload || !payload.domains.length) return <div className="visual-parity-state">Visual Parity has no retained domains.</div>;

  return <OvenRuntime ir={ir} payload={ovenPayload!} />;
}
