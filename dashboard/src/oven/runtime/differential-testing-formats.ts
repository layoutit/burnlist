import { count, percent } from "../differential-testing-render/differential-testing-render.js";
import { differentialTelemetryAvailability } from "../differential-testing-render/differential-testing-renderer.js";

type ResultRow = {
  frame?: number | null;
  frames?: number | null;
  failedFieldCount?: number | null;
  fieldCount?: number | null;
  frameDelta?: number | null;
};

function last(value: unknown): ResultRow | undefined {
  return Array.isArray(value) ? value.at(-1) as ResultRow | undefined : undefined;
}

function ratio(part: unknown, total: unknown): number {
  const denominator = Math.max(0, Number(total) || 0);
  return denominator ? Math.max(0, Number(part) || 0) / denominator * 100 : 0;
}

export function progressHeadline(value: unknown): string {
  const row = last(value);
  return `${count(row?.frame)}/${count(row?.frames)}`;
}

export function lastProgressPercent(value: unknown): number {
  const row = last(value);
  return ratio(row?.frame, row?.frames);
}

export function lastFailedCount(value: unknown): string {
  return count(last(value)?.failedFieldCount);
}

export function lastFailedPercent(value: unknown): number {
  const row = last(value);
  return ratio(row?.failedFieldCount, row?.fieldCount);
}

export function lastFrameDelta(value: unknown): string {
  const delta = last(value)?.frameDelta;
  return delta === null || delta === undefined || !Number.isFinite(Number(delta)) ? "—" : count(Math.abs(Number(delta)));
}

export function lastDeltaPercent(value: unknown): number {
  const row = last(value);
  return ratio(Math.abs(Number(row?.frameDelta) || 0), row?.frames);
}

export function indexById(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return Object.create(null);
  return Object.assign(Object.create(null), Object.fromEntries(value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string") return [];
    return [[(entry as { id: string }).id, entry]];
  })));
}

export function telemetryAvailability(value: unknown) {
  const payload = value && typeof value === "object" && "telemetry" in value
    ? value
    : { telemetry: value };
  return differentialTelemetryAvailability(payload);
}

export const differentialFormatRegistry = Object.freeze({
  "progress-headline": progressHeadline,
  "last-progress-percent": lastProgressPercent,
  "last-failed-count": lastFailedCount,
  "last-failed-percent": lastFailedPercent,
  "last-frame-delta": lastFrameDelta,
  "last-delta-percent": lastDeltaPercent,
  "index-by-id": indexById,
  "telemetry-availability": telemetryAvailability,
});
