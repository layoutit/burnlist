import { fitText, visibleWindow } from "../../theme";
import { useTerminalPalette, type TerminalPalette } from "../../terminal-accessibility";
import { useTerminalChrome } from "../../terminal-chrome";
import type { ListColumn, ListRow } from "../../catalog/list-fixture";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { evaluateOvenBinding, resolveOvenPointer } from "../value-runtime";

export type TerminalListModel = Readonly<{
  columns: readonly ListColumn[];
  rows: readonly ListRow[];
  selectedId?: string;
  expandedId?: string;
  width: number;
  height: number;
  emptyText?: string;
}>;

const toneFor = (row: ListRow, palette: TerminalPalette) => row.tone === "bad" ? palette.red : row.tone === "warn" ? palette.amber : row.tone === "good" ? palette.green : palette.muted;

export function listColumnWidths(columns: readonly ListColumn[], width: number): readonly number[] {
  if (!columns.length) return [];
  const available = Math.max(columns.length, width - 2);
  const floor = Math.max(1, Math.min(4, Math.floor(available / columns.length)));
  const widths = columns.map(() => floor);
  let budget = available - floor * columns.length;
  const grow = (indexes: readonly number[], desired: (column: ListColumn) => number) => {
    for (const index of indexes) {
      const amount = Math.min(budget, Math.max(0, desired(columns[index]!) - widths[index]!));
      widths[index]! += amount; budget -= amount;
    }
  };
  const fixed = columns.flatMap((column, index) => column.width ? [index] : []);
  const flexible = columns.flatMap((column, index) => column.width ? [] : [index]);
  grow(fixed, (column) => column.width ?? floor);
  grow(flexible, (column) => column.minWidth ?? 8);
  for (let cursor = 0; budget > 0; cursor = (cursor + 1) % (flexible.length || columns.length)) {
    const targets = flexible.length ? flexible : columns.map((_, index) => index);
    widths[targets[cursor]!]! += 1; budget -= 1;
  }
  return widths;
}

function ListCell({ value, width, color }: { value: string; width: number; color: string }) {
  return <box width={width} flexShrink={0} paddingLeft={1} overflow="hidden"><text fg={color}>{fitText(value, Math.max(1, width - 1))}</text></box>;
}

function ListLine({ model, row, selected, header }: { model: TerminalListModel; row?: ListRow; selected?: boolean; header?: boolean }) {
  const palette = useTerminalPalette();
  const chrome = useTerminalChrome();
  const widths = listColumnWidths(model.columns, model.width);
  return <box height={1} width={model.width} flexDirection="row" backgroundColor={header ? chrome.header : selected ? chrome.surface : chrome.background} overflow="hidden">
    <box width={2} flexShrink={0}><text fg={selected ? palette.blue : row?.latest ? palette.amber : "transparent"}>{selected ? "▎ " : row?.latest ? "• " : "  "}</text></box>
    {model.columns.map((column, index) => <ListCell key={column.id} width={widths[index]!} color={header ? palette.dim : column.id === "state" ? toneFor(row!, palette) : selected ? palette.foreground : palette.muted} value={header ? column.label : String(row?.cells[column.id] ?? "")} />)}
  </box>;
}

/** Measured, footer-safe list primitive shared by terminal log, ledger, feed, and field previews. */
export function TerminalList({ model }: { model: TerminalListModel }) {
  const palette = useTerminalPalette();
  const selected = Math.max(0, model.rows.findIndex((row) => row.id === model.selectedId));
  const expanded = model.rows.find((row) => row.id === model.expandedId);
  const expandedRows = expanded?.detail ? 1 : 0;
  const rowCapacity = Math.max(1, Math.floor(model.height) - 1 - expandedRows);
  const window = visibleWindow([...model.rows], selected, rowCapacity);
  const selectedInWindow = window.items.some((row) => row.id === model.selectedId);
  return <box width={model.width} height={Math.max(1, Math.floor(model.height))} flexDirection="column" flexGrow={0} flexShrink={0} overflow="hidden">
    <ListLine model={model} header />
    {!model.rows.length && model.emptyText ? <box height={1} paddingLeft={3} overflow="hidden"><text fg={palette.dim}>{fitText(model.emptyText, Math.max(1, model.width - 3))}</text></box> : null}
    {window.items.map((row) => <box key={row.id} flexDirection="column" height={row.id === model.expandedId && row.detail ? 2 : 1} overflow="hidden">
      <ListLine model={model} row={row} selected={row.id === model.selectedId && selectedInWindow} />
      {row.id === model.expandedId && row.detail ? <box height={1} paddingLeft={3} overflow="hidden"><text fg={palette.dim}>{fitText(`↳ ${row.detail}`, Math.max(1, model.width - 3))}</text></box> : null}
    </box>)}
  </box>;
}

const optional = (value: JsonValue | undefined) => value === true || value === "true";

/** Projects the console LogTable contract from compiled IR without Oven-specific branches. */
export function logTableModel(node: TerminalNode, payload: JsonValue | undefined, width: number, height = 8): TerminalListModel {
  const columnNodes = node.children.filter((child) => child.kind === "column");
  const columns = columnNodes.map((child, index) => ({
    id: `column-${index}`,
    label: String(child.attributes.label ?? ""),
    minWidth: 8,
  }));
  const values = resolveOvenPointer(payload, node.attributes.source);
  const source = Array.isArray(values) ? values : [];
  const rows = source.map((item, index) => ({
    id: String(index),
    cells: Object.fromEntries(columnNodes.map((column, columnIndex) => {
      const attrs = column.attributes;
      const value = evaluateOvenBinding({
        source: String(attrs.source),
        format: String(attrs.format ?? "identity"),
        optional: optional(attrs.optional),
        ...(attrs.fallback !== undefined ? { fallback: attrs.fallback } : {}),
      }, payload, item);
      return [`column-${columnIndex}`, String(value ?? "")];
    })),
    latest: index === source.length - 1,
  }));
  return {
    columns,
    rows,
    width,
    height,
    ...(node.attributes.emptyText !== undefined ? { emptyText: String(node.attributes.emptyText) } : {}),
  };
}

/** Generic compiled `log-table` projection; columns and rows come only from the IR/payload. */
export function TerminalLogTable({ node, payload, width, height = 8 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  return <TerminalList model={logTableModel(node, payload, width, height)} />;
}
