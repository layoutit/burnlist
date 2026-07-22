import type { ComponentProps } from "react";
import { validatedOvenPayload } from "@lib/canonical-oven-payload.mjs";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import type { ModelLabPayload } from "@/oven/ModelLabView";

type ModelLabIr = ComponentProps<typeof OvenRuntime>["ir"];

export function adaptModelLabPayload(raw: unknown) {
  return validatedOvenPayload(raw, "Model Lab") as ModelLabPayload;
}

export function ModelLabPageContent({ ir, payload }: {
  ir: ModelLabIr;
  payload: ModelLabPayload;
}) {
  return <OvenRuntime ir={ir} payload={payload} />;
}

export function ModelLabPage({ ir }: { ir: ModelLabIr }) {
  return <OvenRuntime ir={ir} adapt={adaptModelLabPayload} />;
}
