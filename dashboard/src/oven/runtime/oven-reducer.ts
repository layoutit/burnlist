import { resolvePointer } from "../utils/json-pointer";
import { attachTransitionTelemetry, runCollection } from "./collection-pipeline";
import { runtimeCollectionPage } from "./oven-payload-metadata";

type Control = Record<string, unknown> & { id: string; kind: string };
type Collection = Record<string, unknown> & { id: string; pageSize: number };
type IrNode = { kind: string; attributes?: Record<string, unknown>; children?: IrNode[] };
export type OvenIr = { contract: string; theme?: string; controls: Control[]; collections: Collection[]; root?: IrNode[] };
export type RefreshPhase = "idle" | "loading" | "queued" | "running" | "failed";
export type OvenServerPage = { page: number; pageSize: number; pageCount: number; total: number };
export type OvenState = {
  payload: unknown;
  payloadRevision: number;
  scenario?: string; // User request key; accepted payloads remain the selector display authority.
  refresh: { phase: RefreshPhase; error: unknown; generation: number };
  controls: Record<string, string | boolean>;
  collections: Record<string, { pageIndex: number; pageSize: number; serverPage?: OvenServerPage }>;
  expanded: ReadonlySet<string>;
};
export type OvenControlSeed = Record<string, string | boolean>;
export type OvenPageSeed = Record<string, OvenServerPage>;
export type OvenAction =
  | { type: "payloadRequested" }
  | { type: "payloadAccepted"; payload: unknown; generation?: number }
  | { type: "payloadUnchanged"; generation: number }
  | { type: "payloadRejected"; error: unknown; generation: number }
  | { type: "scenarioSelected"; scenarioId: string }
  | { type: "modeSelected"; id: string; value: string }
  | { type: "queryChanged"; id: string; query: string }
  | { type: "toggleChanged"; id: string; active: boolean }
  | { type: "domainSelected"; id: string; selectedId: string }
  | { type: "pagePrevious"; collectionId: string }
  | { type: "pageNext"; collectionId: string }
  | { type: "pageSizeChanged"; collectionId: string; pageSize: number }
  | { type: "toggleExpanded"; key: string };

function nodes(items: IrNode[] = []): IrNode[] {
  return items.flatMap((node) => [node, ...nodes(node.children)]);
}
function attributes(ir: OvenIr, id: string): Record<string, unknown> {
  return nodes(ir.root).find((node) => node.attributes?.id === id)?.attributes ?? {};
}
function descriptor(ir: OvenIr, control: Control | Collection): Record<string, unknown> {
  return { ...attributes(ir, control.id), ...control };
}
function pageCount(length: unknown, size: number): number {
  return Math.max(1, Math.ceil((Array.isArray(length) ? length.length : 0) / Math.max(1, size)));
}
function collectionItems(payload: unknown, collection: Record<string, unknown>): unknown[] {
  const value = resolvePointer(payload, typeof collection.source === "string" ? collection.source : "/");
  return Array.isArray(value) ? value : [];
}
function pipelineItems(ir: OvenIr, payload: unknown, controls: OvenState["controls"], collection: Record<string, unknown>): unknown[] {
  const source = attachTransitionTelemetry(collectionItems(payload, collection), resolvePointer(payload, "/telemetry/fields"));
  const search = typeof collection.searchFrom === "string" ? ir.controls.find((item) => item.id === collection.searchFrom) : undefined;
  const filter = typeof collection.filterFrom === "string" ? ir.controls.find((item) => item.id === collection.filterFrom) : undefined;
  const sort = typeof collection.sortFrom === "string" ? ir.controls.find((item) => item.id === collection.sortFrom) : undefined;
  return runCollection(source, {
    contract: ir.contract, query: search ? String(controls[search.id] ?? "") : "", matchFields: search?.matchFields as string | undefined,
    filter: filter && controls[filter.id] === true ? { key: String(filter.key), active: true } : undefined,
    sort: sort && controls[sort.id] === true ? { key: String(sort.key), active: true } : undefined,
  }, resolvePointer);
}
function clamp(index: number, count: number): number { return Math.max(0, Math.min(index, count - 1)); }
function active(value: unknown): boolean { return value === true || value === "on"; }
function payloadServerPage(payload: unknown, collection: Record<string, unknown>): OvenServerPage | undefined {
  const page = runtimeCollectionPage(payload, collection.source);
  if (!page) return undefined;
  const serverPage = {
    page: Number(page.page),
    pageSize: Number(page.pageSize),
    pageCount: Number(page.pageCount),
    total: Number(page.total),
  };
  return Number.isSafeInteger(serverPage.page) && serverPage.page >= 0
    && Number.isSafeInteger(serverPage.pageSize) && serverPage.pageSize > 0
    && Number.isSafeInteger(serverPage.pageCount) && serverPage.pageCount > 0
    && Number.isSafeInteger(serverPage.total) && serverPage.total >= 0
    ? serverPage
    : undefined;
}

function domainValues(control: Record<string, unknown>, payload: unknown): string[] {
  const source = typeof control.source === "string" ? resolvePointer(payload, control.source) : [];
  if (!Array.isArray(source)) return [];
  return source.map((value) => typeof value === "string" ? value : value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string" ? String((value as Record<string, unknown>).id) : undefined).filter((value): value is string => !!value);
}
function domainInitial(control: Record<string, unknown>, payload: unknown, values: string[]): string | undefined {
  const candidate = typeof control.initialSource === "string" ? resolvePointer(payload, control.initialSource) : undefined;
  const id = typeof candidate === "string" ? candidate : candidate && typeof candidate === "object" && typeof (candidate as Record<string, unknown>).id === "string" ? String((candidate as Record<string, unknown>).id) : undefined;
  return id && values.includes(id) ? id : values[0];
}
function serverControlIds(ir: OvenIr, collections: OvenState["collections"]): Set<string> {
  const ids = new Set<string>();
  for (const item of ir.collections) {
    const collection = descriptor(ir, item);
    if (!collections[item.id]?.serverPage || (collection.paging !== "auto" && collection.paging !== "server")) continue;
    for (const id of [collection.searchFrom, collection.sortFrom, collection.filterFrom]) {
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}
function normalizedControls(ir: OvenIr, payload: unknown, prior: OvenState["controls"] = {}, serverControls = new Set<string>()): OvenState["controls"] {
  const next: OvenState["controls"] = {};
  for (const item of ir.controls) {
    const control = descriptor(ir, item);
    if (control.kind === "search") next[item.id] = typeof prior[item.id] === "string" ? prior[item.id] : "";
    else if (control.kind === "mode-toggle") {
      const options = nodes(ir.root).filter((node) => node.kind === "mode-toggle" && node.attributes?.id === item.id).flatMap((node) => node.children ?? []).filter((node) => node.kind === "option").map((node) => String(node.attributes?.value));
      if (options.length === 0 && Array.isArray(control.options)) options.push(...control.options.map((option) => typeof option === "string" ? option : String((option as Record<string, unknown>).value)));
      const initial = typeof control.initial === "string" ? control.initial : options[0] ?? "";
      next[item.id] = typeof prior[item.id] === "string" && (options.length === 0 || options.includes(String(prior[item.id]))) ? String(prior[item.id]) : initial;
    } else if (control.kind === "domain-tabs") {
      const values = domainValues(control, payload), previous = prior[item.id];
      next[item.id] = typeof previous === "string" && values.includes(previous) ? previous : domainInitial(control, payload, values) ?? "";
    } else {
      const available = payload === undefined || typeof control.requiresSource !== "string" || resolvePointer(payload, control.requiresSource) === control.requiresValue;
      const serverSeeded = serverControls.has(item.id) && typeof prior[item.id] === "boolean";
      next[item.id] = serverSeeded ? prior[item.id] : available && typeof prior[item.id] === "boolean" ? prior[item.id] : available && active(control.initial);
    }
  }
  return next;
}
function resetConsumers(state: OvenState, ir: OvenIr, controlId: string): OvenState["collections"] {
  const next = { ...state.collections };
  for (const item of ir.collections) {
    const collection = descriptor(ir, item);
    if ([collection.searchFrom, collection.sortFrom, collection.filterFrom].includes(controlId)) next[item.id] = { ...next[item.id], pageIndex: 0 };
  }
  return next;
}

export function initOvenState(ir: OvenIr, payload: unknown = undefined, controls: OvenControlSeed = {}, pages: OvenPageSeed = {}): OvenState {
  const collections = Object.fromEntries(ir.collections.map((item) => {
    const collection = descriptor(ir, item);
    const page = pages[item.id] ?? payloadServerPage(payload, collection);
    return [item.id, {
      pageIndex: 0,
      pageSize: Math.max(1, Number(collection.pageSize) || 1),
      ...(page ? { serverPage: { ...page } } : {}),
    }];
  }));
  return {
    payload, payloadRevision: 0, scenario: undefined, refresh: { phase: "idle", error: undefined, generation: 0 },
    controls: normalizedControls(ir, payload, controls, serverControlIds(ir, collections)),
    collections,
    expanded: new Set(),
  };
}

/** Closed, pure oven interaction reducer. */
export function ovenReducer(state: OvenState, action: OvenAction, ir: OvenIr): OvenState {
  switch (action.type) {
    case "payloadRequested":
      if (state.refresh.phase === "loading" || state.refresh.phase === "running") return { ...state, refresh: { ...state.refresh, phase: "queued" } };
      return { ...state, refresh: { phase: state.refresh.phase === "queued" ? "running" : "loading", error: undefined, generation: state.refresh.generation + 1 } };
    case "payloadAccepted": {
      if (action.generation !== undefined && action.generation !== state.refresh.generation) return state;
      const controls = normalizedControls(ir, action.payload, state.controls, serverControlIds(ir, state.collections));
      const collections = Object.fromEntries(ir.collections.map((item) => {
        const collection = descriptor(ir, item), current = state.collections[item.id];
        const serverPage = payloadServerPage(action.payload, collection);
        const serverPaged = !!serverPage && (collection.paging === "auto" || collection.paging === "server");
        return [item.id, {
          ...current,
          pageIndex: serverPaged ? serverPage.page : clamp(current.pageIndex, pageCount(pipelineItems(ir, action.payload, controls, collection), current.pageSize)),
          pageSize: serverPaged ? serverPage.pageSize : current.pageSize,
          ...(serverPage ? { serverPage } : {}),
        }];
      }));
      return { ...state, payload: action.payload, payloadRevision: state.payloadRevision + 1, controls, collections, refresh: { ...state.refresh, phase: state.refresh.phase === "queued" ? "queued" : "idle", error: undefined } };
    }
    case "payloadUnchanged":
      return action.generation !== state.refresh.generation ? state : { ...state, refresh: { ...state.refresh, phase: state.refresh.phase === "queued" ? "queued" : "idle", error: undefined } };
    case "payloadRejected":
      return action.generation !== state.refresh.generation ? state : { ...state, refresh: { ...state.refresh, phase: state.refresh.phase === "queued" ? "queued" : "failed", error: action.error } };
    case "scenarioSelected": return { ...state, scenario: action.scenarioId };
    case "modeSelected": return { ...state, controls: { ...state.controls, [action.id]: action.value } };
    case "queryChanged": return { ...state, controls: { ...state.controls, [action.id]: action.query }, collections: resetConsumers(state, ir, action.id) };
    case "toggleChanged": return { ...state, controls: { ...state.controls, [action.id]: action.active }, collections: resetConsumers(state, ir, action.id) };
    case "domainSelected": return { ...state, controls: { ...state.controls, [action.id]: action.selectedId } };
    case "pagePrevious": return { ...state, collections: { ...state.collections, [action.collectionId]: { ...state.collections[action.collectionId], pageIndex: Math.max(0, state.collections[action.collectionId].pageIndex - 1) } } };
    case "pageNext": return { ...state, collections: { ...state.collections, [action.collectionId]: { ...state.collections[action.collectionId], pageIndex: state.collections[action.collectionId].pageIndex + 1 } } };
    case "pageSizeChanged": return { ...state, collections: { ...state.collections, [action.collectionId]: { ...state.collections[action.collectionId], pageIndex: 0, pageSize: Math.max(1, action.pageSize) } } };
    case "toggleExpanded": {
      const expanded = new Set(state.expanded);
      if (expanded.has(action.key)) expanded.delete(action.key);
      else expanded.add(action.key);
      return { ...state, expanded };
    }
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
