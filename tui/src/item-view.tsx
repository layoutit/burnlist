import { compactTime } from "./theme";
import stringWidth from "string-width";
import { sanitizeTerminalText } from "./terminal-text";
import { useTerminalPalette, type TerminalPalette } from "./terminal-accessibility";
import type { DetailItem } from "./types";

type DetailLine = { text: string; tone: "normal" | "muted" | "dim" | "blue" | "status" };
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function wrap(value: unknown, width: number): string[] {
  const limit = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  for (const source of String(value ?? "").split(/\r?\n/u)) {
    const text = sanitizeTerminalText(source) || " ";
    let line = "";
    for (const word of text.split(" ")) {
      const prefix = line ? " " : "";
      if (line && stringWidth(line) + stringWidth(prefix) + stringWidth(word) > limit) { lines.push(line); line = ""; }
      if (stringWidth(word) <= limit) { line += `${line ? " " : ""}${word}`; continue; }
      for (const { segment: glyph } of graphemes.segment(word)) {
        if (stringWidth(line) + stringWidth(glyph) > limit) { lines.push(line); line = ""; }
        line += glyph;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}

/** Canonical item text is expanded into a viewport window, never clipped or elided. */
export function itemDetailLines(item: DetailItem, width: number): DetailLine[] {
  const lines: DetailLine[] = [
    ...wrap(item.status, width).map((text) => ({ text, tone: "status" as const })),
    ...wrap(item.id, width).map((text) => ({ text, tone: "normal" as const })),
    ...(item.latest ? [{ text: "LATEST", tone: "status" as const }] : []),
    ...wrap(item.title, width).map((text) => ({ text, tone: "normal" as const })),
    ...(item.completedAt ? wrap(`Completed ${compactTime(item.completedAt)} · ${item.completedAt}`, width).map((text) => ({ text, tone: "dim" as const })) : []),
  ];
  for (const [label, value] of Object.entries(item.fields ?? {})) {
    lines.push(...wrap(label.toUpperCase(), width).map((text) => ({ text, tone: "blue" as const })));
    lines.push(...wrap(value, width).map((text) => ({ text, tone: "muted" as const })));
  }
  if (item.detail) {
    lines.push({ text: "COMPLETION DETAIL", tone: "dim" });
    lines.push(...wrap(item.detail, width).map((text) => ({ text, tone: "muted" as const })));
  }
  if (!Object.keys(item.fields ?? {}).length && !item.detail) lines.push({ text: "No additional item detail was recorded.", tone: "dim" });
  return lines;
}

export function itemDetailMaxOffset(item: DetailItem | null, width: number, height: number): number {
  if (!item) return 0;
  const lines = itemDetailLines(item, Math.max(1, width - 4));
  const visible = Math.max(1, height - (lines.length > height ? 1 : 0));
  return Math.max(0, lines.length - visible);
}

function color(line: DetailLine, palette: TerminalPalette, active: boolean) {
  if (line.tone === "muted") return palette.muted;
  if (line.tone === "dim") return palette.dim;
  if (line.tone === "blue") return palette.blue;
  if (line.tone === "status") return active ? palette.green : palette.blue;
  return palette.foreground;
}

export function ItemDetail({ item, width, height = 20, scrollOffset = 0 }: { item: DetailItem | null; width: number; height?: number; scrollOffset?: number }) {
  const palette = useTerminalPalette();
  if (!item) return <box height={height} padding={2}><text fg={palette.dim}>No item is selected.</text></box>;
  const lines = itemDetailLines(item, Math.max(1, width - 4));
  const reserveHint = lines.length > height;
  const visible = Math.max(1, height - (reserveHint ? 1 : 0));
  const maxOffset = Math.max(0, lines.length - visible);
  const start = Math.max(0, Math.min(scrollOffset, maxOffset));
  const window = lines.slice(start, start + visible);
  const hint = `${start > 0 ? "↑ more" : ""}${start > 0 && start < maxOffset ? " · " : ""}${start < maxOffset ? "↓ more" : ""}`;
  return <box height={height} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="column" paddingLeft={2} paddingRight={2}>
    {window.map((line, index) => <text key={`${start}:${index}`} fg={color(line, palette, item.kind === "active")}>{line.text}</text>)}
    {reserveHint ? <text fg={palette.dim}>{hint}</text> : null}
  </box>;
}
