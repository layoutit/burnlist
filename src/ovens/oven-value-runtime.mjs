const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function resolveOvenPointer(payload, pointer, item) {
  if (pointer === "@item") return item;
  if (typeof pointer === "string" && pointer.startsWith("@item/")) return resolveOvenPointer(item, pointer.slice(5));
  if (pointer === "" || pointer === "/") return payload;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  let value = payload;
  for (const segment of pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (value === null || value === undefined || (typeof value !== "object" && typeof value !== "function") || !own(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

const count = (value) => Number(value || 0).toLocaleString("en-US");
const last = (value) => Array.isArray(value) ? value.at(-1) : undefined;
const ratio = (part, total) => { const denominator = Math.max(0, Number(total) || 0); return denominator ? Math.max(0, Number(part) || 0) / denominator * 100 : 0; };
const parseDate = (value) => { if (value instanceof Date) return Number.isNaN(value.valueOf()) ? undefined : value; if (typeof value !== "string" && typeof value !== "number") return undefined; const date = new Date(value); return Number.isNaN(date.valueOf()) ? undefined : date; };
const telemetryAvailability = (value) => {
  const telemetry = value && typeof value === "object" && "telemetry" in value ? value.telemetry : value;
  if (telemetry?.status === "comparable" && Array.isArray(telemetry.fields)) return { status: "comparable", reason: "" };
  if (telemetry?.status === "blocked") return { status: "blocked", reason: Array.isArray(telemetry.blockers) && telemetry.blockers.length ? telemetry.blockers.join(" · ") : "Changed is unavailable because transition telemetry is blocked." };
  return { status: "unavailable", reason: "Changed is unavailable until comparable transition telemetry is published." };
};
const indexById = (value) => Array.isArray(value) ? Object.assign(Object.create(null), Object.fromEntries(value.flatMap((entry) => entry && typeof entry === "object" && typeof entry.id === "string" ? [[entry.id, entry]] : []))) : Object.create(null);

export const ovenFormatRegistry = Object.freeze(Object.assign(Object.create(null), {
  identity: (value) => value,
  plain: (value) => value,
  number: (value) => { if (value === null || value === undefined || value === "") return ""; const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(parsed) : ""; },
  percent: (value) => value === null || value === undefined ? "" : `${(value * 100).toFixed(value < 0.01 ? 3 : 2)}%`,
  delta: (value) => value === null || value === undefined ? "" : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, ""),
  "ratio-to-percent": (value) => { if (value === null || value === undefined) return undefined; const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed * 100 : undefined; },
  length: (value) => typeof value === "string" || Array.isArray(value) ? value.length : undefined,
  "time-only": (value) => { const date = parseDate(value); return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : ""; },
  "relative-age": (value) => { const date = parseDate(value); if (!date) return ""; const seconds = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`; },
  "progress-headline": (value) => `${count(last(value)?.frame)}/${count(last(value)?.frames)}`,
  "last-progress-percent": (value) => ratio(last(value)?.frame, last(value)?.frames),
  "last-failed-count": (value) => count(last(value)?.failedFieldCount),
  "last-failed-percent": (value) => ratio(last(value)?.failedFieldCount, last(value)?.fieldCount),
  "last-frame-delta": (value) => { const delta = last(value)?.frameDelta; return delta === null || delta === undefined || !Number.isFinite(Number(delta)) ? "—" : count(Math.abs(Number(delta))); },
  "last-delta-percent": (value) => ratio(Math.abs(Number(last(value)?.frameDelta) || 0), last(value)?.frames),
  "index-by-id": indexById,
  "telemetry-availability": telemetryAvailability,
}));

export function formatOvenValue(format, value) {
  const formatter = ovenFormatRegistry[format ?? "identity"];
  if (!formatter) throw new Error(`Unknown oven format: ${format}`);
  return formatter(value);
}

export function evaluateOvenBinding(binding, payload, item) {
  if (!binding || typeof binding !== "object" || typeof binding.source !== "string") throw new TypeError("Invalid oven binding");
  const value = resolveOvenPointer(payload, binding.source, item);
  if (value === undefined) {
    if (!binding.optional) throw new Error(`Missing required oven binding source: ${binding.source}`);
    return binding.fallback ?? "";
  }
  return formatOvenValue(binding.format ?? "identity", value);
}
