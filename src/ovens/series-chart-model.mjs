const finite = (value) => typeof value === "number" && Number.isFinite(value);
const chartValue = (raw, categories) => {
  if (finite(raw)) return raw;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "string") {
    if (!categories.has(raw)) categories.set(raw, categories.size);
    return categories.get(raw);
  }
  return null;
};

export const SERIES_CHART_COLORS = Object.freeze({
  pass: "#61d394",
  fail: "#ef4444",
});

export const SERIES_CHART_LAYOUT = Object.freeze({
  aspectRatio: 900 / 58,
  innerPadding: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  surface: "subtle",
  divider: "none",
  axes: false,
  scaleLabels: false,
});

/**
 * Shared, renderer-neutral authority for the console SVG and terminal cells.
 * Input accepts the Oven tuple form or the Storybook ordered-point form.
 */
export function normalizeSeriesChart(samples, options = {}) {
  const mode = options.mode === "value" ? "value" : "delta";
  const labels = Array.isArray(options.labels) ? options.labels : [];
  const categories = new Map();
  const points = (Array.isArray(samples) ? samples : []).map((sample, index) => {
    const tuple = Array.isArray(sample) ? sample : null;
    const record = !tuple && sample && typeof sample === "object" ? sample : {};
    const tick = tuple ? Number(tuple[0]) : index;
    const reference = chartValue(tuple ? tuple[1] : record.reference ?? 0, categories);
    const candidate = chartValue(tuple ? tuple[2] : record.candidate ?? record.value, categories);
    const failed = tuple ? Number(tuple[3]) !== 0 : record.state === "fail" || record.failed === true;
    const value = mode === "delta"
      ? reference === null || candidate === null ? null : candidate - reference
      : candidate;
    return Object.freeze({
      index,
      tick: Number.isFinite(tick) ? tick : index,
      label: String(labels[index] ?? record.label ?? `F${Number.isFinite(tick) ? tick : index}`),
      reference,
      candidate,
      value,
      state: failed ? "fail" : "pass",
    });
  });
  const values = mode === "delta"
    ? points.map((point) => point.value).filter(finite)
    : points.flatMap((point) => [point.reference, point.candidate]).filter(finite);
  if (!values.length) return Object.freeze({
    mode, empty: true, points, domain: Object.freeze({ min: 0, max: 0 }),
    colors: SERIES_CHART_COLORS, layout: SERIES_CHART_LAYOUT,
  });
  let min;
  let max;
  if (mode === "delta") {
    const extent = Math.max(0.000001, ...values.map((value) => Math.abs(value)));
    const limit = extent + Math.max(extent * 0.16, 0.000001);
    min = -limit;
    max = limit;
  } else {
    const low = Math.min(...values, 0);
    const high = Math.max(...values, 0);
    const pad = Math.max((high - low) * 0.16, Math.abs(high || low || 1) * 0.03, 0.000001);
    min = low - pad;
    max = high + pad;
  }
  return Object.freeze({
    mode, empty: false, points, domain: Object.freeze({ min, max }),
    colors: SERIES_CHART_COLORS, layout: SERIES_CHART_LAYOUT,
  });
}
