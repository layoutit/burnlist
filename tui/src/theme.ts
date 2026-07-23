export const palette = Object.freeze({
  foreground: "#e8e8e8",
  soft: "#d4d4d8",
  muted: "#a8a8a8",
  dim: "#686868",
  blue: "#5aa2ff",
  green: "#61d394",
  red: "#ef7171",
  amber: "#fcd34d",
});

export function fitText(value: unknown, width: number): string {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (width <= 0) return "";
  if (text.length <= width) return text.padEnd(width);
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

export function compactTime(value: string | null): string {
  if (!value) return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "—";
  const now = Date.now();
  const age = Math.max(0, now - time.getTime());
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  if (age < 604_800_000) return `${Math.floor(age / 86_400_000)}d ago`;
  return time.toISOString().slice(0, 10);
}

export function progressLabel(done: number | null, total: number, percent: number | null, fallback: string): string {
  if (done === null) return fallback || "—";
  return percent === null ? `${done} / ${total}` : `${done} / ${total} · ${percent}%`;
}

export function visibleWindow<T>(items: T[], selected: number, size: number): { items: T[]; start: number } {
  const count = Math.max(1, Math.floor(size));
  const safe = Math.max(0, Math.min(selected, Math.max(0, items.length - 1)));
  const start = Math.max(0, Math.min(safe - Math.floor(count / 2), Math.max(0, items.length - count)));
  return { items: items.slice(start, start + count), start };
}
