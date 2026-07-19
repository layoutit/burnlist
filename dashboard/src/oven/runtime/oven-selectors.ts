import { attachTransitionTelemetry, runCollection } from "./collection-pipeline";
import type { OvenIr, OvenState } from "./oven-reducer";

type Pointer = (payload: unknown, pointer: string) => unknown;
type IrNode = { kind: string; attributes?: Record<string, unknown>; children?: IrNode[] };
type Descriptor = Record<string, unknown> & { id: string };

function nodes(items: IrNode[] = []): IrNode[] { return items.flatMap((node) => [node, ...nodes(node.children)]); }
function attributes(ir: OvenIr, id: string): Record<string, unknown> {
  return nodes(ir.root as IrNode[]).find((node) => node.attributes?.id === id)?.attributes ?? {};
}
function descriptor(ir: OvenIr, item: Descriptor): Descriptor { return { ...attributes(ir, item.id), ...item }; }
function control(ir: OvenIr, id: unknown): Descriptor | undefined {
  return typeof id === "string" ? ir.controls.find((item) => item.id === id) as Descriptor | undefined : undefined;
}
function pageCount(total: number, pageSize: number): number { return Math.max(1, Math.ceil(total / Math.max(1, pageSize))); }
function activeControl(ir: OvenIr, state: OvenState, id: unknown): { key: string; active: boolean } | undefined {
  const item = control(ir, id);
  return item && typeof item.key === "string" ? { key: item.key, active: state.controls[item.id] === true } : undefined;
}

export function selectMode(state: OvenState, id: string): string | undefined {
  const value = state.controls[id];
  return typeof value === "string" ? value : undefined;
}

export function selectDomain(state: OvenState, id: string): string | undefined { return selectMode(state, id); }

export function selectRefreshStatus(state: OvenState): OvenState["refresh"] { return state.refresh; }

export function selectCollection(state: OvenState, ir: OvenIr, collectionId: string, resolvePointer: Pointer) {
  const base = ir.collections.find((item) => item.id === collectionId);
  if (!base) throw new Error(`Unknown collection: ${collectionId}`);
  const collection = descriptor(ir, base as Descriptor);
  const source = resolvePointer(state.payload, typeof collection.source === "string" ? collection.source : "/");
  const items = attachTransitionTelemetry(Array.isArray(source) ? source : [], resolvePointer(state.payload, "/telemetry/fields"));
  const search = control(ir, collection.searchFrom);
  const query = search ? String(state.controls[search.id] ?? "") : "";
  const visible = runCollection(items, {
    query, matchFields: search?.matchFields as string | undefined,
    filter: activeControl(ir, state, collection.filterFrom),
    sort: activeControl(ir, state, collection.sortFrom), contract: ir.contract,
  }, resolvePointer);
  const current = state.collections[collectionId];
  if (!current) throw new Error(`Missing collection state: ${collectionId}`);
  const count = pageCount(visible.length, current.pageSize);
  const pageIndex = Math.max(0, Math.min(current.pageIndex, count - 1));
  const start = pageIndex * current.pageSize;
  return { pageItems: visible.slice(start, start + current.pageSize), pageIndex, pageCount: count, pageSize: current.pageSize, totalCount: visible.length };
}
