import type { ReactNode } from "react";
import { layoutTerminalNodes, type LayoutCell } from "../layout/layout-runtime";
import type { JsonValue, TerminalNode, TerminalRenderResult } from "../terminal-contract";
import { projectComponentLayout } from "./component-layout";
import { kpiFromNode, kpiStripModel, TerminalKpiItem, TerminalKpiStrip } from "./progress-components";
import { logTableModel, TerminalLogTable } from "./list-components";
import { statusSurfaceModel, TerminalStatusSurface } from "./status-components";
import { mediaModel, TerminalDomainTabs, TerminalFrameCards, TerminalMetricTiles, TerminalVerdictHeader, validateMediaRoots, validateVerdictRoot } from "./media-components";
import { streamingDiffModel, TerminalStreamingDiff, TerminalStreamingDiffHeading } from "./streaming-diff-components";
import { TerminalDifferentialChart, TerminalDifferentialKpiStrip, TerminalDifferentialLogTable, TerminalHybridFieldList } from "./differential-components";

type ComponentProps = Readonly<{ node: TerminalNode; payload?: JsonValue; width: number; height?: number; expanded?: boolean; selectedId?: string }>;
export const TERMINAL_COMPONENT_ROOTS: Readonly<Record<string, (props: ComponentProps) => ReactNode>> = Object.freeze({
  "kpi-strip": TerminalKpiStrip,
  "kpi-item": TerminalKpiItem,
  "log-table": TerminalLogTable,
  "section-header": TerminalStatusSurface,
  "refresh-status": TerminalStatusSurface,
  "domain-note": TerminalStatusSurface,
  "differential-empty-state": TerminalStatusSurface,
  "differential-kpi-strip": TerminalDifferentialKpiStrip,
  "differential-log-table": TerminalDifferentialLogTable,
  "progress-chart": TerminalDifferentialChart,
  "frame-delta-chart": TerminalDifferentialChart,
  "field-list": TerminalHybridFieldList,
  "streaming-diff-heading": TerminalStreamingDiffHeading,
  "diff-card": TerminalStreamingDiff,
});

/** Evaluates every component root before React paint and converts failures to state. */
export function prepareTerminalComponentResult(result: TerminalRenderResult): TerminalRenderResult {
  if (result.status !== "ready" || !result.ir || result.payload === undefined) return result;
  try {
    const projected = projectComponentLayout(result.ir.root, result.state.viewport.width, result.payload, result.state.controls);
    for (const root of projected.roots) {
      if (root.node.kind === "kpi-strip") kpiStripModel(root.node, result.payload, result.state.viewport.width);
      else if (root.node.kind === "kpi-item") kpiFromNode(root.node, result.payload, result.state.viewport.width);
      else if (root.node.kind === "log-table") logTableModel(root.node, result.payload, result.state.viewport.width);
      else if (root.node.kind === "differential-kpi-strip") TerminalDifferentialKpiStrip({ node: root.node, payload: result.payload, width: result.state.viewport.width });
      else if (root.node.kind === "diff-card") streamingDiffModel(root.node, result.payload, result.state.expandedKeys.includes("streaming-diff:first-file"));
      else if (["section-header", "refresh-status", "differential-empty-state"].includes(root.node.kind) || root.node.kind === "domain-note" && typeof root.node.attributes.selectionFrom !== "string") statusSurfaceModel(root.node, result.payload);
      else if (root.node.kind === "verdict-header") validateVerdictRoot(root.node, result.payload);
    }
    if (projected.roots.some((root) => ["domain-tabs", "metric-tiles", "frame-card"].includes(root.node.kind))) validateMediaRoots(result.ir.root, result.payload, result.state.controls);
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ...result, status: "error", diagnostics: [...result.diagnostics, { code: "RENDER_BINDING", message }] };
  }
}

function StructuralCell({ cell }: { cell: LayoutCell }) {
  const text = cell.collapsed && cell.text ? `↳ ${cell.text}` : cell.text ?? "";
  return <box position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden"><text>{text}</text></box>;
}

/**
 * Production component-aware Oven surface. Structural-only callers retain the
 * byte-stable StructuralOvenViewport; this surface reserves component roots,
 * suppresses their projected descendants, and paints through a closed registry.
 */
export function TerminalOvenViewport({ result, footer = "q:back  esc:exit" }: { result: TerminalRenderResult; footer?: string }) {
  const prepared = prepareTerminalComponentResult(result), viewport = prepared.state.viewport, footerHeight = 2, bodyHeight = Math.max(1, viewport.height - footerHeight);
  if (prepared.status !== "ready" || !prepared.ir || prepared.payload === undefined) {
    const message = prepared.diagnostics.at(-1)?.message ?? prepared.status;
    return <box width={viewport.width} height={viewport.height} overflow="hidden"><text>{message}</text></box>;
  }
  const projected = projectComponentLayout(prepared.ir.root, viewport.width, prepared.payload, prepared.state.controls), layout = layoutTerminalNodes(projected.nodes, viewport, prepared.state.focusId, footerHeight);
  const roots = new Map(projected.roots.map((root) => [root.path, root])), componentPaths = [...roots.keys()];
  return <box width={viewport.width} height={viewport.height} position="relative" overflow="hidden">
    {layout.cells.map((cell) => {
      const root = roots.get(cell.path), hidden = componentPaths.some((path) => cell.path.startsWith(`${path}/`));
      if (root) {
        const Component = TERMINAL_COMPONENT_ROOTS[root.node.kind];
        if (root.node.kind === "verdict-header") return <box key={cell.path} position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden"><TerminalVerdictHeader node={root.node} payload={prepared.payload} width={cell.rect.width} /></box>;
        if (root.node.kind === "domain-note" && typeof root.node.attributes.selectionFrom === "string") {
          const note = mediaModel(prepared.ir!.root, prepared.payload, prepared.state.controls).note;
          return <box key={cell.path} position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden"><text>{note}</text></box>;
        }
        if (["domain-tabs", "metric-tiles", "frame-card"].includes(root.node.kind)) {
          const media = mediaModel(prepared.ir!.root, prepared.payload, prepared.state.controls);
          const content = root.node.kind === "domain-tabs" ? <TerminalDomainTabs model={media} width={cell.rect.width} /> : root.node.kind === "metric-tiles" ? <TerminalMetricTiles model={media} width={cell.rect.width} /> : <TerminalFrameCards model={media} width={cell.rect.width} height={cell.rect.height} />;
          return <box key={cell.path} position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden">{content}</box>;
        }
        const collectionId = typeof root.node.attributes.collectionFrom === "string" ? root.node.attributes.collectionFrom : "";
        const fieldKey = prepared.state.expandedKeys.find((key) => key.startsWith(`${collectionId}:`));
        return Component ? <box key={cell.path} position="absolute" left={cell.rect.x} top={cell.rect.y} width={cell.rect.width} height={cell.rect.height} overflow="hidden"><Component node={root.node} payload={prepared.payload} width={cell.rect.width} height={cell.rect.height} {...(root.node.kind === "diff-card" ? { expanded: prepared.state.expandedKeys.includes("streaming-diff:first-file") } : root.node.kind === "field-list" ? { expanded: !!fieldKey, selectedId: fieldKey?.slice(collectionId.length + 1) } : {})} /></box> : null;
      }
      return hidden ? null : <StructuralCell key={cell.path} cell={cell} />;
    })}
    <box position="absolute" left={0} top={bodyHeight} width={viewport.width} height={footerHeight} overflow="hidden" border={["top"]} borderColor="#686868"><text>{footer}</text></box>
  </box>;
}
