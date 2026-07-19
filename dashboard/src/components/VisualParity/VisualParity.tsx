import { useMemo } from "react";
import { useVisualParityData } from "@hooks";
import { adaptVisualParity } from "@lib/visual-parity-oven-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import ovenIr from "../../../../ovens/visual-parity/visual-parity.ir.json";

export function VisualParityPage() {
  const { payload, error, loading } = useVisualParityData();
  const ovenPayload = useMemo(() => payload ? adaptVisualParity(payload) : null, [payload]);

  if (loading && !payload) return <div className="visual-parity-state">Loading Visual Parity…</div>;
  if (error && !payload) return <div className="visual-parity-state is-error">{error}</div>;
  if (!payload || !payload.domains.length) return <div className="visual-parity-state">Visual Parity has no retained domains.</div>;

  return <OvenRuntime ir={ovenIr} payload={ovenPayload!} />;
}
