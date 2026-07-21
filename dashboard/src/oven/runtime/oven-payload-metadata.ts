const RUNTIME_METADATA_KEY = "__burnlistOvenRuntime";

type RuntimeMetadata = {
  collectionPages?: Record<string, unknown>;
  frameDeltaMetrics?: unknown;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function metadata(payload: unknown): RuntimeMetadata | undefined {
  const value = record(payload)?.[RUNTIME_METADATA_KEY];
  return record(value) as RuntimeMetadata | undefined;
}

export function withDifferentialTestingEnvelope(payload: Record<string, unknown>, fieldPage: unknown, frameDeltaMetrics: unknown, hasFrameDeltaMetrics: boolean): Record<string, unknown> {
  const page = record(fieldPage);
  let next = payload;
  if (page) {
    next = { ...payload, fields: Array.isArray(page.fields) ? page.fields : [] };
    const telemetry = record(payload.telemetry);
    if (telemetry?.status === "comparable") {
      next.telemetry = { ...telemetry, fields: Array.isArray(page.telemetryFields) ? page.telemetryFields : [] };
    }
  }
  if (!page && !hasFrameDeltaMetrics) return next;
  const prior = metadata(next);
  return {
    ...next,
    [RUNTIME_METADATA_KEY]: {
      ...prior,
      ...(page ? { collectionPages: { ...prior?.collectionPages, "/fields": page } } : {}),
      ...(hasFrameDeltaMetrics ? { frameDeltaMetrics } : {}),
    },
  };
}

export function runtimeCollectionPage(payload: unknown, source: unknown): Record<string, unknown> | undefined {
  if (typeof source !== "string") return undefined;
  return record(metadata(payload)?.collectionPages?.[source]);
}

export function runtimeFrameDeltaMetrics(payload: unknown): { present: boolean; value?: unknown } {
  const value = metadata(payload);
  return value && Object.hasOwn(value, "frameDeltaMetrics")
    ? { present: true, value: value.frameDeltaMetrics }
    : { present: false };
}

export function differentialExactPrefixFrameDeltaMetrics(payload: unknown, metrics: unknown): Record<string, unknown> | null {
  const data = record(payload);
  const metricData = record(metrics);
  const ratios = metricData?.frameDeviationRatios;
  const progress = data?.progress;
  const latest = Array.isArray(progress) ? record(progress.at(-1)) : undefined;
  const clearedFrame = Number(latest?.frame);
  const frameCount = Number(latest?.frames);
  if (!Array.isArray(ratios) || !Number.isSafeInteger(clearedFrame) || !Number.isSafeInteger(frameCount)
    || clearedFrame < 0 || clearedFrame > frameCount
    || ratios.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) return null;
  let clearedTick = clearedFrame;
  if (frameCount !== ratios.length) {
    const frames = record(record(data?.summary)?.frames);
    const uniqueTicks = Number(frames?.uniqueTicks);
    if (!Number.isSafeInteger(uniqueTicks) || uniqueTicks !== ratios.length) return null;
    if (clearedFrame === frameCount) clearedTick = ratios.length;
    else {
      const firstFailingTick = Number(latest?.firstFailingTick);
      if (!Number.isSafeInteger(firstFailingTick) || firstFailingTick < 0 || firstFailingTick >= ratios.length) return null;
      clearedTick = firstFailingTick;
    }
  }
  return {
    ...metricData,
    frameDeviationRatios: ratios.map((value, tick) => tick < clearedTick ? 0 : Number(value)),
    firstFailingFrame: clearedTick < ratios.length ? clearedTick : -1,
  };
}
