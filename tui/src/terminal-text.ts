import stringWidth from "string-width";

/** Terminal-safe text normalization and deterministic cell measurement. */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const bidi = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const mark = /\p{Mark}/u;

/** Makes all terminal controls and direction overrides visible, never executable. */
export function sanitizeTerminalText(value: unknown): string {
  const input = String(value ?? "");
  let output = "";
  for (const glyph of input) {
    const point = glyph.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) output += "�";
    else if (point === 0x09) output += "⇥";
    else if (point === 0x0a) output += "␊";
    else if (point === 0x0d) output += "␍";
    else if (point < 0x20) output += String.fromCodePoint(0x2400 + point);
    else if (point === 0x7f) output += "␡";
    else if (point >= 0x80 && point <= 0x9f) output += "�";
    else if (bidi.test(glyph)) output += "�";
    else output += glyph;
  }
  const normalized = output.replace(/[\p{White_Space}]+/gu, " ").trim();
  return [...segmenter.segment(normalized)].map((part) => mark.test([...part.segment][0] ?? "") ? `◌${part.segment}` : part.segment).join("");
}

function clusterWidth(cluster: string): number {
  return stringWidth(cluster);
}

export function terminalCellWidth(value: unknown): number {
  return [...segmenter.segment(sanitizeTerminalText(value))].reduce((total, part) => total + clusterWidth(part.segment), 0);
}

/** Clips on grapheme boundaries and reserves one cell for an ellipsis when needed. */
export function fitTerminalText(value: unknown, width: number, pad = false): string {
  const limit = Math.max(0, Math.floor(width));
  if (!limit) return "";
  const text = sanitizeTerminalText(value);
  if (terminalCellWidth(text) <= limit) return pad ? `${text}${" ".repeat(limit - terminalCellWidth(text))}` : text;
  if (limit === 1) return "…";
  let output = "", used = 0;
  for (const part of segmenter.segment(text)) {
    const size = clusterWidth(part.segment);
    if (used + size > limit - 1) break;
    output += part.segment;
    used += size;
  }
  return `${output}…`;
}
