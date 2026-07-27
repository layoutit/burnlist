import { resolveOvenPointer } from "./value-runtime";
import type { JsonValue, TerminalCollection, TerminalCollectionState, TerminalOvenIR } from "./terminal-contract";
import { collectionDescriptor, itemIdentity } from "./ir-descriptor";

type Row = Record<string, JsonValue>;
type ControlValue = string | boolean;
export type TerminalCollectionPage = Readonly<{ pageItems: readonly JsonValue[]; pageIndex: number; pageCount: number; pageSize: number; totalCount: number; itemKeys: readonly (string | undefined)[] }>;

const dtContract = "burnlist-differential-testing-data@1";
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown) => { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; };
const active = (controls: Readonly<Record<string, ControlValue>>, id: unknown) => typeof id === "string" && controls[id] === true;
const pages = (total: number, size: number) => Math.max(1, Math.ceil(total / Math.max(1, size)));
const clamp = (value: number, count: number) => Math.max(0, Math.min(value, count - 1));
const identities = (items: readonly JsonValue[], key: string | undefined) => { const seen = new Map<string, number>(); return items.map((item, index) => { const raw = itemIdentity(item, key, index), count = seen.get(raw) ?? 0; seen.set(raw, count + 1); return itemIdentity(item, key, index, count); }); };

function telemetry(row: Row): Row | undefined { const value = row.transitionTelemetry ?? row.telemetry; return record(value) ? value : undefined; }
function filter(contract: string, key: unknown, row: Row): boolean | undefined {
  if (contract === dtContract && key === "non-pass") return number(row.failedSampleCount) + number(row.missingSampleCount) > 0;
  return undefined;
}
function compare(contract: string, key: unknown, left: Row, right: Row): number | undefined {
  if (contract !== dtContract || key !== "changed") return undefined;
  const a = telemetry(left), b = telemetry(right);
  const changed = (x: Row | undefined) => number(x?.failToPassCount) + number(x?.passToFailCount);
  const improvement = (x: Row | undefined) => number(x?.failToPassCount) - number(x?.passToFailCount);
  return changed(b) - changed(a) || improvement(b) - improvement(a);
}

/** Adds console-equivalent, payload-sidecar transition data without mutating input rows. */
export function attachTransitionTelemetry(items: readonly JsonValue[], source: unknown): readonly JsonValue[] {
  if (!Array.isArray(source)) return items;
  const byId = new Map<string, JsonValue>();
  for (const value of source) if (record(value) && typeof value.id === "string") byId.set(value.id, value);
  return byId.size ? items.map((item) => record(item) && typeof item.id === "string" && byId.has(item.id) ? { ...item, transitionTelemetry: byId.get(item.id)! } : item) : items;
}

export function runTerminalCollection(items: readonly JsonValue[], options: Readonly<{ contract: string; query?: string; matchFields?: unknown; filterKey?: unknown; filterActive?: boolean; sortKey?: unknown; sortActive?: boolean }>): readonly JsonValue[] {
  const fields = typeof options.matchFields === "string" ? options.matchFields.split(/\s+/u).filter(Boolean) : [];
  const needle = (options.query ?? "").trim().toLowerCase();
  let result = needle ? items.filter((item) => record(item) && fields.some((field) => String(resolveOvenPointer(item, field) ?? "").toLowerCase().includes(needle))) : [...items];
  if (options.filterActive) result = result.filter((item) => record(item) && filter(options.contract, options.filterKey, item) === true);
  if (!options.sortActive) return result;
  const known = result.some((item) => record(item) && compare(options.contract, options.sortKey, item, item) !== undefined);
  if (!known) return result;
  result = result.filter((item) => record(item) && (options.sortKey !== "changed" || number(telemetry(item)?.failToPassCount) + number(telemetry(item)?.passToFailCount) > 0));
  return result.map((item, index) => ({ item, index })).sort((a, b) => record(a.item) && record(b.item) ? (compare(options.contract, options.sortKey, a.item, b.item) ?? 0) || a.index - b.index : a.index - b.index).map(({ item }) => item);
}

const control = (ir: TerminalOvenIR, id: unknown) => typeof id === "string" ? ir.controls.find((item) => item.id === id) : undefined;
export function selectTerminalCollection(ir: TerminalOvenIR, payload: JsonValue | undefined, controls: Readonly<Record<string, ControlValue>>, collection: TerminalCollection, state: TerminalCollectionState): TerminalCollectionPage {
  const descriptor = collectionDescriptor(ir, collection.id); if (!descriptor) return { pageItems: [], pageIndex: 0, pageCount: 1, pageSize: state.pageSize, totalCount: 0, itemKeys: [] };
  const raw = resolveOvenPointer(payload, descriptor.source);
  const rawItems = Array.isArray(raw) ? raw : [], items = attachTransitionTelemetry(rawItems, resolveOvenPointer(payload, "/telemetry/fields"));
  const keys = identities(rawItems, descriptor.itemKey), keyOf = new Map<JsonValue, string>(); items.forEach((item, index) => keyOf.set(item, keys[index]));
  const server = state.serverPage;
  if (server && (descriptor.paging === "server" || descriptor.paging === "auto")) return { pageItems: items, pageIndex: clamp(server.page, server.pageCount), pageCount: server.pageCount, pageSize: server.pageSize, totalCount: server.total, itemKeys: items.map((item, index) => keyOf.get(item) ?? `@row:${index}`) };
  const search = control(ir, descriptor.searchFrom), filterControl = control(ir, descriptor.filterFrom), sort = control(ir, descriptor.sortFrom);
  const visible = runTerminalCollection(items, { contract: ir.contract, query: search ? String(controls[search.id] ?? "") : "", matchFields: search?.matchFields, filterKey: filterControl?.key, filterActive: active(controls, filterControl?.id), sortKey: sort?.key, sortActive: active(controls, sort?.id) });
  const pageCount = pages(visible.length, state.pageSize), pageIndex = clamp(state.pageIndex, pageCount), start = pageIndex * state.pageSize;
  const pageItems = visible.slice(start, start + state.pageSize); return { pageItems, pageIndex, pageCount, pageSize: state.pageSize, totalCount: visible.length, itemKeys: pageItems.map((item, index) => keyOf.get(item) ?? `@row:${start + index}`) };
}

/** Selects the matching compiled switch case, including its optional default. */
export function selectTerminalCase(node: TerminalOvenIR["root"][number], payload: JsonValue | undefined, controls: Readonly<Record<string, ControlValue>>) {
  if (node.kind !== "switch") return undefined;
  const value = typeof node.attributes.modeFrom === "string" ? controls[node.attributes.modeFrom] : typeof node.attributes.source === "string" ? resolveOvenPointer(payload, node.attributes.source) : undefined;
  return node.children.find((child) => child.kind === "case" && child.attributes.value === value) ?? node.children.find((child) => child.kind === "case" && child.attributes.default === true);
}
