import { isJsonValue } from "./terminal-contract";
// @ts-expect-error Shared browser-safe runtime is authored as package JavaScript.
import { evaluateOvenBinding as sharedBinding, formatOvenValue, ovenFormatRegistry, resolveOvenPointer as sharedPointer } from "../../../src/ovens/oven-value-runtime.mjs";

export { formatOvenValue, ovenFormatRegistry };
export type OvenBinding = Readonly<{ source: string; format?: string; optional?: boolean; fallback?: unknown }>;

const safe = (value: unknown) => value === undefined || isJsonValue(value);
export function resolveOvenPointer(payload: unknown, pointer: unknown, item?: unknown): unknown {
  if (!safe(payload) || !safe(item) || typeof pointer !== "string") return undefined;
  return sharedPointer(payload, pointer, item);
}
export function evaluateOvenBinding(binding: OvenBinding, payload: unknown, item?: unknown): unknown {
  if (!isJsonValue(binding) || !safe(payload) || !safe(item)) throw new TypeError("Oven binding inputs must be JSON-safe");
  return sharedBinding(binding, payload, item);
}
