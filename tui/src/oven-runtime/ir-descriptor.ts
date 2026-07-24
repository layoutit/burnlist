import { resolveOvenPointer } from "./value-runtime";
import type { JsonValue, TerminalCollection, TerminalNode, TerminalOvenIR } from "./terminal-contract";

type Attributes = Readonly<Record<string, JsonValue>>;
const record = (value: unknown): value is Readonly<Record<string, unknown>> => !!value && typeof value === "object" && !Array.isArray(value);
const nodes = (items: readonly TerminalNode[]): readonly TerminalNode[] => items.flatMap((node) => [node, ...nodes(node.children)]);
export type CollectionDescriptor = TerminalCollection & Attributes;
export function collectionDescriptor(ir: TerminalOvenIR, id: string): CollectionDescriptor | undefined {
  const declared = ir.collections.find((item) => item.id === id), node = nodes(ir.root).find((item) => item.kind === "collection" && item.attributes.id === id);
  return declared && node ? { ...node.attributes, ...declared } : undefined;
}
export function collectionDescriptors(ir: TerminalOvenIR): readonly CollectionDescriptor[] { return ir.collections.flatMap((item) => { const found = collectionDescriptor(ir, item.id); return found ? [found] : []; }); }
export function serverPage(payload: JsonValue | undefined, source: string): { page: number; pageSize: number; pageCount: number; total: number } | undefined {
  const value = resolveOvenPointer(payload, "/__burnlistOvenRuntime/collectionPages"), page = record(value) ? value[source] : undefined;
  if (!record(page)) return undefined;
  const out = { page: Number(page.page), pageSize: Number(page.pageSize), pageCount: Number(page.pageCount), total: Number(page.total) };
  return Number.isSafeInteger(out.page) && out.page >= 0 && Number.isSafeInteger(out.pageSize) && out.pageSize > 0 && Number.isSafeInteger(out.pageCount) && out.pageCount > 0 && Number.isSafeInteger(out.total) && out.total >= 0 ? out : undefined;
}
export function itemIdentity(item: JsonValue, itemKey?: string, sourceIndex = 0, occurrence = 0): string {
  const value = itemKey ? resolveOvenPointer({}, itemKey.startsWith("@item") ? itemKey : `@item${itemKey}`, item) : undefined;
  const scalar = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return scalar ? occurrence ? `${scalar}#${occurrence}` : scalar : `@row:${sourceIndex}`;
}
