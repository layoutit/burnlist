import type { ResolvedOvenIr } from "@hooks";
import { validatedOvenPayload } from "@lib/canonical-oven-payload.mjs";
import type { VisualParityPayload } from "@lib";
import { adaptVisualParity } from "@lib/visual-parity-oven-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";

export function adaptVisualParityPayload(raw: unknown) {
  return adaptVisualParity(validatedOvenPayload(raw, "Visual Parity") as VisualParityPayload);
}

export function VisualParityPage({ ir }: { ir: ResolvedOvenIr }) {
  return <OvenRuntime ir={ir} adapt={adaptVisualParityPayload} />;
}
