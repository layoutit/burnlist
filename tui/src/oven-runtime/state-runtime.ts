import { selectTerminalCollection } from "./collection-runtime";
import type { JsonValue, TerminalCollectionState, TerminalOvenIR, TerminalState } from "./terminal-contract";
import { resolveOvenPointer } from "./value-runtime";
import { collectionDescriptor, collectionDescriptors, serverPage } from "./ir-descriptor";

export type TerminalRuntimeState = Readonly<TerminalState & { payload?: JsonValue; payloadRevision: number }>;
export type TerminalRuntimeAction = Readonly<{ type: "payloadAccepted"; payload: JsonValue } | { type: "modeSelected" | "queryChanged" | "domainSelected"; id: string; value: string } | { type: "toggleChanged"; id: string; active: boolean } | { type: "pagePrevious" | "pageNext"; collectionId: string } | { type: "pageSizeChanged"; collectionId: string; pageSize: number } | { type: "toggleExpanded"; key: string } | { type: "focusNext" | "focusPrevious" } | { type: "focusSet"; id: string }>;
const clamp = (value: number, count: number) => Math.max(0, Math.min(value, count - 1));
const controls = (ir: TerminalOvenIR, id: string) => ir.controls.find((item) => item.id === id);
const modeValues = (ir: TerminalOvenIR, id: string): string[] => {
  const visit = (nodes: typeof ir.root): string[] => nodes.flatMap((node) => node.kind === "mode-toggle" && node.attributes.id === id ? node.children.filter((child) => child.kind === "option" && typeof child.attributes.value === "string").map((child) => String(child.attributes.value)) : visit(node.children));
  return visit(ir.root);
};
const domains = (source: unknown) => Array.isArray(source) ? source.flatMap((value) => typeof value === "string" ? [value] : value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string" ? [String((value as Record<string, unknown>).id)] : []) : [];
/** All payload reads go through B3's descriptor-safe JSON pointer wrapper. */
const pointer = (payload: JsonValue | undefined, source: unknown) => typeof source === "string" ? resolveOvenPointer(payload, source) : undefined;
const serverControlIds = (ir: TerminalOvenIR, collections: TerminalRuntimeState["collections"]) => new Set(collectionDescriptors(ir).flatMap((item) => collections[item.id]?.serverPage && (item.paging === "server" || item.paging === "auto") ? [item.searchFrom, item.sortFrom, item.filterFrom].filter((id): id is string => typeof id === "string") : []));

export function initTerminalRuntime(ir: TerminalOvenIR, payload?: JsonValue, focusableIds: readonly string[] = []): TerminalRuntimeState {
  const controlsOut: Record<string, string | boolean> = {}, collectionsOut: Record<string, TerminalCollectionState> = {};
  for (const item of ir.controls) {
    if (item.kind === "search") controlsOut[item.id] = "";
    else if (item.kind === "domain-tabs") { const values = domains(pointer(payload, item.source)); const initial = pointer(payload, item.initialSource); controlsOut[item.id] = typeof initial === "string" && values.includes(initial) ? initial : values[0] ?? ""; }
    else if (item.kind === "mode-toggle") { const values = modeValues(ir, item.id), initial = typeof item.initial === "string" ? item.initial : values[0] ?? ""; controlsOut[item.id] = values.includes(initial) ? initial : values[0] ?? ""; }
    else { const available = payload === undefined || typeof item.requiresSource !== "string" || pointer(payload, item.requiresSource) === item.requiresValue; controlsOut[item.id] = available && (item.initial === "on" || item.initial === true); }
  }
  for (const item of collectionDescriptors(ir)) { const page = (item.paging === "server" || item.paging === "auto") ? serverPage(payload, item.source) : undefined; collectionsOut[item.id] = { pageIndex: page?.page ?? 0, pageSize: page?.pageSize ?? Math.max(1, item.pageSize ?? 25), ...(page ? { serverPage: page } : {}) }; }
  return { viewport: { width: 80, height: 24 }, controls: controlsOut, collections: collectionsOut, selections: {}, ...(focusableIds[0] ? { focusId: focusableIds[0] } : {}), expandedKeys: [], diagnostics: [], ...(payload === undefined ? {} : { payload }), payloadRevision: 0 };
}

function resetConsumers(state: TerminalRuntimeState, ir: TerminalOvenIR, id: string) { const next = { ...state.collections }; for (const item of collectionDescriptors(ir)) if ([item.searchFrom, item.filterFrom, item.sortFrom].includes(id)) next[item.id] = { ...next[item.id], pageIndex: 0 }; return next; }
function normalizeRefresh(state: TerminalRuntimeState, ir: TerminalOvenIR, payload: JsonValue): TerminalRuntimeState {
  const nextControls = { ...state.controls }, nextCollections: Record<string, TerminalCollectionState> = {};
  const serverSeeded = serverControlIds(ir, state.collections);
  for (const item of ir.controls) {
    if (item.kind === "domain-tabs") { const values = domains(pointer(payload, item.source)), current = nextControls[item.id], initial = pointer(payload, item.initialSource); nextControls[item.id] = typeof current === "string" && values.includes(current) ? current : typeof initial === "string" && values.includes(initial) ? initial : values[0] ?? ""; }
    if (item.kind === "mode-toggle") { const values = modeValues(ir, item.id), current = nextControls[item.id]; nextControls[item.id] = typeof current === "string" && values.includes(current) ? current : typeof item.initial === "string" && values.includes(item.initial) ? item.initial : values[0] ?? ""; }
    if (item.kind === "filter-toggle" || item.kind === "sort-toggle") { const available = typeof item.requiresSource !== "string" || pointer(payload, item.requiresSource) === item.requiresValue; nextControls[item.id] = serverSeeded.has(item.id) && typeof nextControls[item.id] === "boolean" ? nextControls[item.id] : available && typeof nextControls[item.id] === "boolean" ? nextControls[item.id] : available && (item.initial === "on" || item.initial === true); }
  }
  for (const item of collectionDescriptors(ir)) { const current = state.collections[item.id] ?? { pageIndex: 0, pageSize: Math.max(1, item.pageSize ?? 25) }, server = (item.paging === "server" || item.paging === "auto") ? serverPage(payload, item.source) : undefined, seeded = server ? { ...current, pageIndex: server.page, pageSize: server.pageSize, serverPage: server } : { ...current, serverPage: undefined }; const page = selectTerminalCollection(ir, payload, nextControls, item, seeded); nextCollections[item.id] = { ...seeded, pageIndex: page.pageIndex }; }
  return { ...state, payload, payloadRevision: state.payloadRevision + 1, controls: nextControls, collections: nextCollections };
}
export function reduceTerminalRuntime(state: TerminalRuntimeState, action: TerminalRuntimeAction, ir: TerminalOvenIR, focusableIds: readonly string[] = []): TerminalRuntimeState {
  if (action.type === "payloadAccepted") { const next = normalizeRefresh(state, ir, action.payload); return focusableIds.includes(next.focusId ?? "") ? next : { ...next, ...(focusableIds[0] ? { focusId: focusableIds[0] } : { focusId: undefined }) }; }
  if (action.type === "focusNext" || action.type === "focusPrevious") { if (!focusableIds.length) return { ...state, focusId: undefined }; const old = Math.max(0, focusableIds.indexOf(state.focusId ?? focusableIds[0])); return { ...state, focusId: focusableIds[clamp(old + (action.type === "focusNext" ? 1 : -1), focusableIds.length)] }; }
  if (action.type === "focusSet") return focusableIds.includes(action.id) ? { ...state, focusId: action.id } : state;
  if (action.type === "toggleExpanded") return action.key ? { ...state, expandedKeys: state.expandedKeys.includes(action.key) ? state.expandedKeys.filter((key) => key !== action.key) : [...state.expandedKeys, action.key] } : state;
  if (action.type === "pagePrevious" || action.type === "pageNext" || action.type === "pageSizeChanged") { const descriptor = collectionDescriptor(ir, action.collectionId), current = descriptor && state.collections[action.collectionId]; if (!current) return state; const pageSize = action.type === "pageSizeChanged" ? action.pageSize : current.pageSize; if (!Number.isSafeInteger(pageSize) || pageSize < 1) return state; return { ...state, collections: { ...state.collections, [action.collectionId]: { ...current, pageIndex: action.type === "pagePrevious" ? Math.max(0, current.pageIndex - 1) : action.type === "pageNext" ? current.pageIndex + 1 : 0, pageSize } } }; }
  if (action.type !== "modeSelected" && action.type !== "queryChanged" && action.type !== "domainSelected" && action.type !== "toggleChanged") return state;
  const item = controls(ir, action.id); if (!item) return state;
  if (action.type === "modeSelected") return item.kind === "mode-toggle" && modeValues(ir, item.id).includes(action.value) ? { ...state, controls: { ...state.controls, [item.id]: action.value } } : state;
  if (action.type === "queryChanged") return item.kind === "search" ? { ...state, controls: { ...state.controls, [item.id]: action.value }, collections: resetConsumers(state, ir, item.id) } : state;
  if (action.type === "domainSelected") { const values = domains(pointer(state.payload, item.source)); return item.kind === "domain-tabs" && values.includes(action.value) ? { ...state, controls: { ...state.controls, [item.id]: action.value } } : state; }
  if (action.type === "toggleChanged") return (item.kind === "filter-toggle" || item.kind === "sort-toggle") ? { ...state, controls: { ...state.controls, [item.id]: action.active }, collections: resetConsumers(state, ir, item.id) } : state;
  return state;
}
export const selectMode = (state: TerminalRuntimeState, id: string) => typeof state.controls[id] === "string" ? state.controls[id] as string : undefined;
export const selectDomain = selectMode;
export const selectExpanded = (state: TerminalRuntimeState, key: string) => state.expandedKeys.includes(key);
export const selectFocus = (state: TerminalRuntimeState) => state.focusId;
