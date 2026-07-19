import type { ReactNode } from "react";

type ColumnNode = { kind: string; attributes?: Record<string, unknown> };
type LogTableNode = { attributes?: Record<string, unknown>; children?: ColumnNode[] };
type ResolvePointer = (payload: unknown, pointer: string) => unknown;
type FormatRegistry = Record<string, (value: unknown) => unknown>;

export type LogTableProps = {
  columns: string[];
  rows: { key?: string; className: string; cells: { className: string; content: ReactNode }[] }[];
  emptyState?: ReactNode;
};

function attributes(node: { attributes?: Record<string, unknown> }): Record<string, unknown> {
  return node.attributes ?? {};
}

function columnClass(column: ColumnNode): string {
  const attrs = attributes(column);
  const label = String(attrs.label ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const tone = typeof attrs.tone === "string" ? attrs.tone : "";
  return ["log-table-cell", label, tone].filter(Boolean).join(" ");
}

function itemValue(item: unknown, source: unknown, resolvePointer: ResolvePointer): unknown {
  if (source === "@item") return item;
  if (typeof source === "string" && source.startsWith("@item/")) return resolvePointer(item, source.slice(5));
  return undefined;
}

function rowKey(item: unknown, index: number, itemKey: unknown, resolvePointer: ResolvePointer): string {
  const value = typeof itemKey === "string" ? resolvePointer(item, itemKey) : undefined;
  return typeof value === "string" || typeof value === "number" ? String(value) : String(index);
}

/** Builds the closed LogTable component contract from declarative runtime IR. */
export function buildLogTableProps(node: LogTableNode, payload: unknown, { resolvePointer, formatRegistry }: { resolvePointer: ResolvePointer; formatRegistry: FormatRegistry }): LogTableProps {
  const attrs = attributes(node);
  const columns = (node.children ?? []).filter((child) => child.kind === "column");
  const entries = typeof attrs.source === "string" ? resolvePointer(payload, attrs.source) : undefined;
  const source = Array.isArray(entries) ? entries : [];
  const emptyText = attrs.emptyText ?? attrs["empty-text"];

  return {
    columns: columns.map((column) => String(attributes(column).label ?? "")),
    rows: source.map((item, index) => ({
      key: rowKey(item, index, attrs.itemKey ?? attrs["item-key"], resolvePointer),
      className: "log-row no-detail log-table-row",
      cells: columns.map((column) => {
        const columnAttrs = attributes(column);
        const value = itemValue(item, columnAttrs.source, resolvePointer);
        const optional = columnAttrs.optional === true || columnAttrs.optional === "true";
        if (value === undefined && !optional) throw new Error(`Missing required log-table column source: ${String(columnAttrs.source)}`);
        const content = value === undefined ? (columnAttrs.fallback ?? "") : (formatRegistry[String(columnAttrs.format ?? "identity")] ?? formatRegistry.identity)(value);
        return { className: columnClass(column), content };
      }),
    })),
    emptyState: source.length === 0 && emptyText !== undefined ? String(emptyText) : undefined,
  };
}
