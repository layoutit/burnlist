import type { ReactNode } from "react";
import type { CellGrid } from "glyphcss";
import "../../glyph-surface";
// @ts-expect-error Shared pure metric authority is JavaScript by design.
import { allocateBurnCells, burnDonutCounts as sharedBurnCounts, clampProgressPercent, waffleMetricData as sharedWaffleData } from "../../../../src/ovens/oven-progress-metrics.mjs";
import { fitLayoutText } from "../layout/layout-runtime";
import type { JsonValue, TerminalBinding, TerminalNode } from "../terminal-contract";
import { evaluateOvenBinding } from "../value-runtime";
import { progressGlyphFrame, type ProgressGlyphKind } from "./progress-glyph";

export type ProgressMetric = Readonly<{ total?: number; failed?: number; blocked?: number }>;
export type BurnEntry = Readonly<{ result?: string }>;
export type TerminalKpi = Readonly<{ heading: string; title?: string; value: string; visual?: string; visualFrame?: CellGrid; variant?: string; icon?: string }>;
export type TerminalKpiStripModel = Readonly<{ ariaLabel?: string; title?: string; items: readonly TerminalKpi[] }>;

const scalarText = (value: unknown) => value === undefined || value === null ? "" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
const pointer = (value: unknown): value is string => typeof value === "string" && value.startsWith("/");
const directBinding = (source: string, format?: unknown, optional?: unknown, fallback?: JsonValue): TerminalBinding => ({ source, ...(typeof format === "string" ? { format } : {}), ...(optional === true ? { optional: true } : {}), ...(fallback !== undefined ? { fallback } : {}) });
const bound = (binding: TerminalBinding, payload: JsonValue | undefined) => evaluateOvenBinding(binding, payload);
function property(node: TerminalNode, name: string, payload: JsonValue | undefined): unknown {
  let value: unknown;
  const explicit = node.bindings[name];
  if (explicit) value = bound(explicit, payload);
  const attribute = node.attributes[name];
  if (attribute !== undefined) value = pointer(attribute) ? bound(directBinding(attribute), payload) : attribute;
  return value;
}
function source(node: TerminalNode, payload: JsonValue | undefined): unknown {
  const value = node.attributes.source;
  if (typeof value !== "string") return undefined;
  return bound(directBinding(value, node.attributes.format, node.attributes.optional, node.attributes.fallback), payload);
}
function childSlot(node: TerminalNode, slot: string, payload: JsonValue | undefined, width: number): unknown {
  let value: unknown;
  for (const child of node.children) {
    const named = typeof child.attributes.slot === "string" ? child.attributes.slot : undefined;
    const implicit = node.kind === "kpi-item" && ((child.kind === "icon" || child.kind === "progress-donut") ? "visual" : child.kind === "progress-value" ? "value" : undefined);
    if ((named ?? implicit) !== slot) continue;
    if (child.kind === "text") value = typeof child.attributes.source === "string" ? bound(directBinding(child.attributes.source, child.attributes.format, child.attributes.optional, child.attributes.fallback), payload) : child.attributes.text;
    else if (child.kind === "icon") value = { icon: String(child.attributes.name) };
    else if (["progress-donut", "burn-donut", "waffle-metric"].includes(child.kind)) {
      const raw = source(child, payload);
      value = { text: componentText(child, payload, width), frame: progressGlyphFrame(child.kind as ProgressGlyphKind, raw, width) };
    } else value = componentText(child, payload, width);
  }
  return value;
}

/** Compact, cell-stable substitute for the console SVG progress ring. */
export function progressDonutText(percent: unknown, width = 8): string {
  const cells = Math.max(3, Math.floor(width)), clamped = clampProgressPercent(percent), done = Math.round(clamped / 100 * cells);
  return `${"●".repeat(done)}${"○".repeat(cells - done)} ${Math.round(clamped)}%`;
}

export function burnDonutCounts(entries: readonly BurnEntry[]) {
  return sharedBurnCounts(entries) as Readonly<Record<"improved" | "worsened" | "unchanged" | "reverted", number>>;
}

function apportionedBurnBar(entries: readonly BurnEntry[], width: number): string {
  const cells = Math.max(1, Math.floor(width));
  const represented = allocateBurnCells(entries, cells) as Array<{ name: "improved" | "worsened" | "unchanged" | "reverted"; cells: number }>;
  if (!represented.length) return "○".repeat(cells);
  const glyphs = { improved: "●", worsened: "×", unchanged: "·", reverted: "!" };
  return represented.map((group) => glyphs[group.name].repeat(group.cells)).join("");
}

/** Result distribution follows the console's amount sort and stable tie order. */
export function burnDonutText(entries: readonly BurnEntry[], width = 8): string {
  const total = entries.length, cells = Math.max(1, Math.floor(width));
  return `${apportionedBurnBar(entries, cells)} ${total}`;
}

export function waffleMetricData(metric: ProgressMetric) {
  return sharedWaffleData(metric) as { failed: number; failedCells: number; empty: boolean };
}

export function waffleMetricText(metric: ProgressMetric, width = 12): string {
  const data = waffleMetricData(metric), cells = Math.max(3, Math.floor(width));
  if (data.empty) return `${"□".repeat(cells)} 0`;
  const failed = Math.min(cells, Math.round(data.failedCells / 96 * cells));
  return `${"■".repeat(failed)}${"□".repeat(cells - failed)} ${data.failed}`;
}

export function checklistProgressValue(done: unknown, total: unknown, percent: unknown): string {
  return `${scalarText(done)} · ${scalarText(total)} (${scalarText(percent)}%)`;
}

export function iconText(name: string | undefined): string {
  return ({ ClipboardList: "▤", Clock3: "◷", Gauge: "◒", TimerReset: "↺" } as Record<string, string>)[name ?? ""] ?? "•";
}

function componentText(node: TerminalNode, payload: JsonValue | undefined, width: number): string {
  if (node.kind === "progress-donut") return progressDonutText(source(node, payload), width);
  if (node.kind === "burn-donut") { const value = source(node, payload); return burnDonutText(Array.isArray(value) ? value as readonly BurnEntry[] : [], width); }
  if (node.kind === "waffle-metric") { const value = source(node, payload); return waffleMetricText(value && typeof value === "object" && !Array.isArray(value) ? value as ProgressMetric : {}, width); }
  if (node.kind === "progress-value") return checklistProgressValue(property(node, "done", payload), property(node, "total", payload), property(node, "percent", payload));
  return "";
}

export function kpiFromNode(node: TerminalNode, payload: JsonValue | undefined, width = 16): TerminalKpi {
  let heading = property(node, "heading", payload), title = property(node, "title", payload), value = property(node, "value", payload);
  if (typeof node.attributes.source === "string") value = source(node, payload);
  const headingSlot = childSlot(node, "heading", payload, width), titleSlot = childSlot(node, "title", payload, width), valueSlot = childSlot(node, "value", payload, width), visualSlot = childSlot(node, "visual", payload, Math.max(3, width - 4));
  if (headingSlot !== undefined) heading = headingSlot; if (titleSlot !== undefined) title = titleSlot; if (valueSlot !== undefined) value = valueSlot;
  let icon = visualSlot && typeof visualSlot === "object" && "icon" in visualSlot ? String((visualSlot as { icon: string }).icon) : undefined;
  let visual = typeof visualSlot === "string" ? visualSlot : undefined;
  const visualFrame = visualSlot && typeof visualSlot === "object" && "frame" in visualSlot ? (visualSlot as { frame: CellGrid }).frame : undefined;
  if (visualSlot && typeof visualSlot === "object" && "text" in visualSlot) visual = String((visualSlot as { text: string }).text);
  if (typeof node.attributes.icon === "string") { icon = node.attributes.icon; visual = undefined; }
  return { heading: scalarText(heading), title: scalarText(title) || undefined, value: scalarText(value), visual, visualFrame, variant: scalarText(node.attributes.variant) || undefined, icon };
}

export function kpiStripModel(node: TerminalNode, payload: JsonValue | undefined, width: number): TerminalKpiStripModel {
  return { ariaLabel: scalarText(property(node, "ariaLabel", payload) ?? property(node, "aria-label", payload)) || undefined, title: scalarText(property(node, "title", payload)) || undefined, items: node.children.filter((child) => child.kind === "kpi-item").map((child) => kpiFromNode(child, payload, Math.max(8, Math.floor(width / Math.max(1, node.children.length))))) };
}
export const kpiStripFromNodes = (nodes: readonly TerminalNode[], payload: JsonValue | undefined, width: number) => nodes.filter((node) => node.kind === "kpi-item").map((node) => kpiFromNode(node, payload, Math.max(8, Math.floor(width / Math.max(1, nodes.length)))));

function KpiCell({ item, width }: { item: TerminalKpi; width: number }) {
  const variants = { current: "›", scenario: "◎", burns: "◉", fields: "▦", frames: "▤" } as Record<string, string>;
  const prefix = item.icon ? `${iconText(item.icon)} ` : item.variant ? `${variants[item.variant] ?? "◆"} ` : "";
  return <box width={width} height={3} overflow="hidden"><text>{fitLayoutText(`${prefix}${item.heading}`, width)}</text>{item.visualFrame ? <glyphSurface frame={item.visualFrame} width={item.visualFrame.cols} height={1} /> : item.visual ? <text>{fitLayoutText(item.visual, width)}</text> : null}<text>{fitLayoutText(item.value || item.visual || item.title || "—", width)}</text></box>;
}

export function TerminalKpiItem({ node, payload, width }: { node: TerminalNode; payload?: JsonValue; width: number }) {
  return <KpiCell item={kpiFromNode(node, payload, width)} width={width} />;
}

/** Generic OpenTUI projection of a compiled kpi-strip; no Oven identity branches. */
export function TerminalKpiStrip({ node, payload, width }: { node: TerminalNode; payload?: JsonValue; width: number }) {
  const model = kpiStripModel(node, payload, width), narrow = width < model.items.length * 18, metadata = model.title ?? model.ariaLabel;
  if (!model.items.length) return <text>{fitLayoutText(metadata || "No metrics", width)}</text>;
  const cellWidth = narrow ? width : Math.max(8, Math.floor(width / model.items.length));
  return <box flexDirection="column" width={width} overflow="hidden">{metadata ? <text>{fitLayoutText(metadata, width)}</text> : null}<box flexDirection={narrow ? "column" : "row"} width={width} overflow="hidden">{model.items.map((item, index) => <KpiCell key={`${item.heading}-${index}`} item={item} width={cellWidth} />)}</box></box>;
}

export function ProgressComponentText({ node, payload, width = 24 }: { node: TerminalNode; payload?: JsonValue; width?: number }): ReactNode {
  return <text>{fitLayoutText(componentText(node, payload, width), width)}</text>;
}
