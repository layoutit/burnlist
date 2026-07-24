import { selectTerminalCollection } from "./collection-runtime";
import { collectionDescriptor } from "./ir-descriptor";
import type { TerminalRuntimeAction, TerminalRuntimeState } from "./state-runtime";
import type { JsonValue, TerminalControl, TerminalOvenIR } from "./terminal-contract";
import { resolveOvenPointer } from "./value-runtime";

const nodes = (root: TerminalOvenIR["root"]): TerminalOvenIR["root"] =>
  root.flatMap((node) => [node, ...nodes(node.children)]);

const control = (ir: TerminalOvenIR, kind: string): TerminalControl | undefined =>
  ir.controls.find((item) => item.kind === kind);

const options = (ir: TerminalOvenIR, id: string): string[] =>
  nodes(ir.root).flatMap((node) =>
    node.kind === "mode-toggle" && node.attributes.id === id
      ? node.children.flatMap((child) =>
        child.kind === "option" && typeof child.attributes.value === "string"
          ? [child.attributes.value]
          : [])
      : []);

function domainValues(payload: JsonValue | undefined, source: unknown): string[] {
  const value = typeof source === "string" ? resolveOvenPointer(payload, source) : undefined;
  return Array.isArray(value) ? value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.id === "string") return [entry.id];
    return [];
  }) : [];
}

const cycle = (values: readonly string[], current: unknown, direction: -1 | 1) => {
  if (!values.length) return null;
  const index = Math.max(0, values.indexOf(String(current ?? values[0])));
  return values[(index + direction + values.length) % values.length] ?? null;
};

function collectionAction(key: string, ir: TerminalOvenIR, state: TerminalRuntimeState): TerminalRuntimeAction | null {
  const collection = ir.collections[0];
  if (!collection) return null;
  if (key === "up" || key === "down") return { type: "selectionMoved", collectionId: collection.id, direction: key === "up" ? -1 : 1 };
  if (key === "n" || key === "p") return { type: key === "n" ? "pageNext" : "pagePrevious", collectionId: collection.id };
  if (key === "z") {
    const descriptor = collectionDescriptor(ir, collection.id), current = state.collections[collection.id];
    const pagination = nodes(ir.root).find((node) => node.kind === "pagination" && node.attributes.collectionFrom === collection.id);
    const sizes = String(pagination?.attributes.pageSizes ?? "").split(/\s+/u).map(Number).filter((size) => Number.isSafeInteger(size) && size > 0);
    if (!descriptor || !current || !sizes.length) return null;
    return { type: "pageSizeChanged", collectionId: collection.id, pageSize: sizes[(sizes.indexOf(current.pageSize) + 1 + sizes.length) % sizes.length]! };
  }
  if (key === "return" || key === "enter") {
    const descriptor = collectionDescriptor(ir, collection.id), current = state.collections[collection.id];
    if (!descriptor || !current) return null;
    const page = selectTerminalCollection(ir, state.payload, state.controls, descriptor, current);
    const selected = state.selections[collection.id];
    const itemKey = selected && page.itemKeys.includes(selected) ? selected : page.itemKeys[0];
    return itemKey ? { type: "toggleExpanded", key: `${collection.id}:${itemKey}` } : null;
  }
  return null;
}

export function terminalKeyboardAction(key: string, ir: TerminalOvenIR, state: TerminalRuntimeState): TerminalRuntimeAction | null {
  const domain = control(ir, "domain-tabs");
  if (domain && (key === "left" || key === "right")) {
    const value = cycle(domainValues(state.payload, domain.source), state.controls[domain.id], key === "left" ? -1 : 1);
    return value ? { type: "domainSelected", id: domain.id, value } : null;
  }
  const mode = control(ir, "mode-toggle");
  if (mode && (key === "m" || key === "c")) {
    const value = cycle(options(ir, mode.id), state.controls[mode.id], 1);
    return value ? { type: "modeSelected", id: mode.id, value } : null;
  }
  if (key === "f" || key === "s") {
    const toggle = control(ir, key === "f" ? "filter-toggle" : "sort-toggle");
    return toggle ? { type: "toggleChanged", id: toggle.id, active: state.controls[toggle.id] !== true } : null;
  }
  const collection = collectionAction(key, ir, state);
  if (collection) return collection;
  if ((key === "return" || key === "enter") && ir.requirements.components.includes("checklist-event-cards")) {
    return { type: "toggleExpanded", key: "checklist-event-cards:latest" };
  }
  if (key === "tab") return { type: "focusNext" };
  return null;
}

export function terminalSearchControl(ir: TerminalOvenIR): TerminalControl | null {
  return control(ir, "search") ?? null;
}
