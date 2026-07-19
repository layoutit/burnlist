import type { Binding, CellDef, JsonValue, OvenViewDef, SectionDef, SlotDef } from "../OvenView/types";

type IrBinding = Binding & { optional?: boolean; fallback?: string };
type IrNode = {
  kind: string;
  attributes: Record<string, unknown>;
  bindings: Record<string, IrBinding>;
  children: IrNode[];
};
type OvenIr = { id: string; theme?: string; root: IrNode[] };

const components: Record<string, string> = Object.freeze({
  box: "Box",
  "kpi-strip": "KpiStrip",
  "kpi-item": "KpiItem",
  "progress-donut": "ProgressDonut",
  "section-header": "SectionHeader",
  "checklist-progress-value": "ChecklistProgressValue",
});

const unsupported = new Set([
  "log-table", "collection", "each", "switch", "case", "field-toolbar", "mode-toggle", "option",
  "search", "sort-toggle", "filter-toggle", "pagination", "field-list", "refresh-status", "domain-tabs", "column",
]);

function fail(node: IrNode): never {
  throw new Error(`Unsupported in static lowering: ${node.kind}`);
}

function key(node: IrNode, path: string): string {
  return typeof node.attributes.id === "string" ? node.attributes.id : `${path}-${node.kind}`;
}

function jsonProps(values: Record<string, unknown>): Record<string, JsonValue> {
  return values as Record<string, JsonValue>;
}

function binding(source: unknown, format: unknown): Binding | undefined {
  return typeof source === "string" ? { source, ...(typeof format === "string" ? { format } : {}) } : undefined;
}

function gridStyle(attributes: Record<string, unknown>): Record<string, string | number> {
  const style: Record<string, string | number> = { display: "grid" };
  if (typeof attributes.columns === "number") style.gridTemplateColumns = `repeat(${attributes.columns}, minmax(0, 1fr))`;
  if (typeof attributes.rows === "number") style.gridTemplateRows = `repeat(${attributes.rows}, ${typeof attributes.rowHeight === "number" ? `${attributes.rowHeight}px` : "auto"})`;
  return style;
}

function panelStyle(attributes: Record<string, unknown>): Record<string, string> {
  const style: Record<string, string> = {};
  if (typeof attributes.column === "number") style.gridColumn = `${attributes.column}${typeof attributes.columnSpan === "number" ? ` / span ${attributes.columnSpan}` : ""}`;
  if (typeof attributes.row === "number") style.gridRow = `${attributes.row}${typeof attributes.rowSpan === "number" ? ` / span ${attributes.rowSpan}` : ""}`;
  return style;
}

function lowerSlot(node: IrNode, path: string): SlotDef {
  if (node.kind === "icon") return { icon: String(node.attributes.name) };
  if (node.kind === "text") {
    if (typeof node.attributes.text === "string") return { text: node.attributes.text };
    throw new Error("A source text slot must be lowered as its parent binding");
  }
  return lowerCell(node, path);
}

function lowerCell(node: IrNode, path: string): CellDef {
  if (unsupported.has(node.kind)) return fail(node);
  const component = components[node.kind];
  if (!component) return fail(node);
  const attrs = node.attributes;
  const props: Record<string, unknown> = {};
  const bind: Record<string, Binding> = { ...node.bindings };
  if (typeof attrs.id === "string") props.id = attrs.id;
  if (typeof attrs.class === "string") props.className = attrs.class;
  if (node.kind === "box") {
    props.element = attrs.element;
    if (typeof attrs.text === "string") props.text = attrs.text;
  }
  if (node.kind === "kpi-strip") {
    if (typeof attrs.ariaLabel === "string") props.ariaLabel = attrs.ariaLabel;
    if (typeof attrs.title === "string") props.title = attrs.title;
  }
  if (node.kind === "kpi-item") {
    if (typeof attrs.heading === "string") props.heading = attrs.heading;
    if (typeof attrs.title === "string") props.title = attrs.title;
    const source = binding(attrs.source, attrs.format);
    if (source) bind.value = source;
  }
  if (node.kind === "progress-donut") {
    const source = binding(attrs.source, attrs.format);
    if (source) bind.percent = source;
  }
  if (node.kind === "section-header") {
    if (typeof attrs.title === "string") props.title = attrs.title;
    const source = binding(attrs.source, attrs.format);
    if (source) bind.count = source;
  }
  const slots: Record<string, SlotDef> = {};
  const children: CellDef[] = [];
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child.kind === "bind") continue;
    const slot = child.attributes.slot;
    if (child.kind === "text" && typeof slot === "string" && typeof child.attributes.source === "string") {
      bind[slot] = { source: child.attributes.source, ...(typeof child.attributes.format === "string" ? { format: child.attributes.format } : {}) };
    } else if (typeof slot === "string") slots[slot] = lowerSlot(child, `${path}-${index}`);
    else children.push(lowerCell(child, `${path}-${index}`));
  }
  return { component, key: key(node, path), ...(Object.keys(props).length ? { props: jsonProps(props) } : {}), ...(Object.keys(bind).length ? { bind } : {}), ...(Object.keys(slots).length ? { slots } : {}), ...(children.length ? { children } : {}) };
}

function lowerSection(node: IrNode, path: string, inherited?: SectionDef): SectionDef[] {
  if (unsupported.has(node.kind)) return fail(node);
  if (node.kind === "grid") {
    const grid: SectionDef = { element: "div", className: "oven-grid", props: jsonProps({ style: gridStyle(node.attributes) }), cells: [], key: key(node, path) };
    const panels: SectionDef[] = [];
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      if (child.kind === "panel") {
        const panel = lowerSection(child, `${path}-${index}`)[0];
        panels.push(panel);
      } else grid.cells.push(lowerCell(child, `${path}-${index}`));
    }
    return [grid, ...panels];
  }
  if (node.kind === "stack" || node.kind === "panel") {
    const style = node.kind === "panel" ? panelStyle(node.attributes) : { display: "flex", flexDirection: node.attributes.direction === "row" ? "row" : "column" };
    const section: SectionDef = { element: node.kind === "panel" ? "section" : "div", className: `oven-${node.kind}`, props: jsonProps({ style }), cells: [], key: key(node, path), ...inherited };
    for (let index = 0; index < node.children.length; index += 1) section.cells.push(lowerCell(node.children[index], `${path}-${index}`));
    return [section];
  }
  if (node.kind === "box") {
    const element = node.attributes.element;
    const section: SectionDef = {
      element: element === "section" || element === "main" || element === "span" ? element : "div",
      ...(typeof node.attributes.class === "string" ? { className: node.attributes.class } : {}),
      ...(typeof node.attributes.id === "string" ? { props: jsonProps({ id: node.attributes.id }) } : {}),
      ...(typeof node.attributes.text === "string" ? { text: node.attributes.text } : {}),
      cells: [], key: key(node, path), ...inherited,
    };
    for (let index = 0; index < node.children.length; index += 1) section.cells.push(lowerCell(node.children[index], `${path}-${index}`));
    return [section];
  }
  return [{ element: "div", cells: [lowerCell(node, path)], key: key(node, path) }];
}

/** Lowers the non-interactive, root-pointer-only IR subset into OvenView's static shape. */
export function lowerOvenIr(ir: OvenIr): OvenViewDef {
  if (!ir || !Array.isArray(ir.root)) throw new TypeError("Invalid oven IR");
  return { sections: ir.root.flatMap((node, index) => lowerSection(node, `root-${index}`)) };
}
