import { createElement, Fragment } from "react";
import { OvenView } from "../OvenView/OvenView";
import type { JsonValue } from "../OvenView/types";
import { resolvePointer } from "../utils/json-pointer";
import { lowerOvenIr } from "./lower-oven-ir";
import type { OvenAction, OvenIr, OvenState } from "./oven-reducer";
import { selectCollection, selectMode } from "./oven-selectors";
import { ControlAdapter } from "./control-adapters";
import { ChecklistWidgetAdapter, WidgetAdapter } from "./widget-adapters";
import { Box } from "../Box/Box";
import { LogTable } from "../LogTable";
import { buildLogTableProps } from "./log-table-adapter";
import { ModelLabView, type ModelLabPayload } from "../ModelLabView";

export type OvenNodeDef = { kind: string; attributes?: Record<string, unknown>; bindings?: Record<string, unknown>; children?: OvenNodeDef[] };
export type OvenNodeProps = { node: OvenNodeDef; ir: OvenIr; state: OvenState; dispatch: (action: OvenAction) => void; item?: unknown; path?: string };
const staticKinds = new Set(["box", "grid", "panel", "stack", "kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "section-header", "progress-value", "differential-kpi-strip", "differential-log-table", "progress-chart", "frame-delta-chart", "differential-empty-state", "icon", "text", "bind"]);
const documentStaticKinds = new Set([...staticKinds, "checklist-burn-panel", "checklist-ledger", "checklist-event-cards", "streaming-diff-heading", "diff-card", "feed-list", "file-diff"]);
const attrs = (node: OvenNodeDef) => node.attributes ?? {};

export function isStaticOvenNode(node: OvenNodeDef): boolean { return staticKinds.has(node.kind) && (node.children ?? []).every(isStaticOvenNode); }
export function isStaticOvenDocument(node: OvenNodeDef): boolean { return documentStaticKinds.has(node.kind) && (node.children ?? []).every(isStaticOvenDocument); }
function scopedNode(node: OvenNodeDef): OvenNodeDef {
  const pointer = (source: unknown) => typeof source !== "string" ? source : source === "@item" ? "/__ovenItem" : source.startsWith("@item/") ? `/__ovenItem${source.slice(5)}` : source.startsWith("/") || source === "" ? `/__ovenRoot${source || "/"}` : source;
  return { ...node, attributes: Object.fromEntries(Object.entries(attrs(node)).map(([key, value]) => [key, key === "source" ? pointer(value) : value])), bindings: Object.fromEntries(Object.entries(node.bindings ?? {}).map(([key, value]) => [key, value && typeof value === "object" ? { ...(value as object), source: pointer((value as { source?: unknown }).source) } : value])), children: (node.children ?? []).map(scopedNode) };
}
function staticView(node: OvenNodeDef, ir: OvenIr, root: unknown, item?: unknown) {
  const lowered = lowerOvenIr({ id: "runtime", theme: ir.theme, root: [item === undefined ? node : scopedNode(node)] });
  const payload = item === undefined ? root : { __ovenRoot: root, __ovenItem: item };
  return <OvenView def={lowered} payload={payload as JsonValue} />;
}
function layoutStyle(node: OvenNodeDef): Record<string, string> {
  const a = attrs(node);
  if (node.kind === "stack") return { display: "flex", flexDirection: a.direction === "row" ? "row" : "column" };
  if (node.kind === "grid") return { display: "grid", ...(typeof a.columns === "number" ? { gridTemplateColumns: `repeat(${a.columns}, minmax(0, 1fr))` } : {}) };
  if (node.kind === "panel") return { ...(typeof a.column === "number" ? { gridColumn: `${a.column}${typeof a.columnSpan === "number" ? ` / span ${a.columnSpan}` : ""}` } : {}), ...(typeof a.row === "number" ? { gridRow: `${a.row}${typeof a.rowSpan === "number" ? ` / span ${a.rowSpan}` : ""}` } : {}) };
  return {};
}

/** Trusted dispatcher: static IR is lowered, while the closed interactive vocabulary uses adapters. */
export function OvenNode({ node, ir, state, dispatch, item, path = "root" }: OvenNodeProps) {
  if (isStaticOvenNode(node)) return <Fragment key={path}>{staticView(node, ir, state.payload, item)}</Fragment>;
  if (node.kind === "switch") {
    const source = attrs(node).source;
    const selected = typeof source === "string"
      ? resolvePointer(state.payload, source)
      : selectMode(state, String(attrs(node).modeFrom ?? ""));
    const branch = (node.children ?? []).find((child) => child.kind === "case" && attrs(child).value === selected) ?? (node.children ?? []).find((child) => child.kind === "case" && attrs(child).default === true);
    return <>{(branch?.children ?? []).map((child, index) => <OvenNode key={`${path}-${index}`} node={child} ir={ir} state={state} dispatch={dispatch} item={item} path={`${path}-${index}`} />)}</>;
  }
  if (node.kind === "collection") {
    const selection = selectCollection(state, ir, String(attrs(node).id ?? ""), resolvePointer);
    return <>{(node.children ?? []).flatMap((child, index) => {
      if (child.kind === "each") return selection.pageItems.map((pageItem, itemIndex) => <OvenNode key={`${path}-${index}-${itemIndex}`} node={child} ir={ir} state={state} dispatch={dispatch} item={pageItem} path={`${path}-${index}-${itemIndex}`} />);
      return <OvenNode key={`${path}-${index}`} node={child} ir={ir} state={state} dispatch={dispatch} item={item} path={`${path}-${index}`} />;
    })}</>;
  }
  if (node.kind === "each") return <>{(node.children ?? []).map((child, index) => <OvenNode key={`${path}-${index}`} node={child} ir={ir} state={state} dispatch={dispatch} item={item} path={`${path}-${index}`} />)}</>;
  if (node.kind === "model-lab-view") return <ModelLabView payload={resolvePointer(state.payload, String(attrs(node).source ?? "/")) as ModelLabPayload} />;
  if (node.kind === "log-table") return <LogTable {...buildLogTableProps(node, state.payload, { resolvePointer })} />;
  if (["checklist-burn-panel", "checklist-ledger", "checklist-event-cards"].includes(node.kind)) return <ChecklistWidgetAdapter node={node} payload={state.payload} />;
  if (["mode-toggle", "domain-tabs", "field-toolbar", "pagination"].includes(node.kind)) return <ControlAdapter node={node} ir={ir} state={state} dispatch={dispatch} />;
  if (["field-list", "refresh-status", "verdict-header", "metric-tiles", "domain-note", "frame-card"].includes(node.kind)) return <WidgetAdapter node={node} ir={ir} state={state} dispatch={dispatch} />;
  if (node.kind === "box") return <Box element={String(attrs(node).element) as "div" | "section" | "main" | "span"} className={typeof attrs(node).class === "string" ? attrs(node).class : undefined} dataDetailTab={typeof attrs(node).dataDetailTab === "string" ? attrs(node).dataDetailTab : undefined} id={typeof attrs(node).id === "string" ? attrs(node).id : undefined} text={typeof attrs(node).text === "string" ? attrs(node).text : undefined}>{(node.children ?? []).map((child, index) => <OvenNode key={`${path}-${index}`} node={child} ir={ir} state={state} dispatch={dispatch} item={item} path={`${path}-${index}`} />)}</Box>;
  if (["grid", "panel", "stack"]) return createElement(node.kind === "panel" ? "section" : "div", { className: `oven-${node.kind}`, style: layoutStyle(node) }, (node.children ?? []).map((child, index) => <OvenNode key={`${path}-${index}`} node={child} ir={ir} state={state} dispatch={dispatch} item={item} path={`${path}-${index}`} />));
  return null;
}
