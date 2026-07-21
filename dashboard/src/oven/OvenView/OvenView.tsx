/*
 * Tier-C limits: cells do not express event callbacks (DomainTabs.onSelect or
 * expand toggles), component-local React state, live subscriptions such as
 * useOvenLiveData, or arbitrary JSX fragments in rich multi-child value slots.
 * Keep those bespoke, or model a value as nested cells.
 */
import { createElement, Fragment, type ReactElement } from "react";
import { resolvePointer } from "../utils/json-pointer";
import { componentRegistry, formatRegistry, iconRegistry } from "./registries";
import type { CellDef, JsonValue, OvenViewDef, SlotDef } from "./types";

export type OvenViewProps = {
  def: OvenViewDef;
  payload: JsonValue;
};

function resolveSlot(slotDef: SlotDef, payload: JsonValue): ReactElement | string | null {
  if ("component" in slotDef) return resolveCell(slotDef, payload);
  if ("icon" in slotDef) {
    const icon = iconRegistry[slotDef.icon];
    if (!icon) throw new Error(`Unknown oven icon: ${slotDef.icon}`);
    return icon as ReactElement;
  }
  return slotDef.text;
}

function resolveCell(cell: CellDef, payload: JsonValue): ReactElement {
  const Component = componentRegistry[cell.component];
  if (!Component) throw new Error(`Unknown oven component: ${cell.component}`);

  const props: Record<string, unknown> = { ...cell.props };
  for (const [name, binding] of Object.entries(cell.bind ?? {})) {
    const format = formatRegistry[binding.format ?? "identity"];
    if (!format) throw new Error(`Unknown oven format: ${binding.format}`);
    props[name] = format(resolvePointer(payload, binding.source));
  }
  for (const [name, slotDef] of Object.entries(cell.slots ?? {})) {
    props[name] = resolveSlot(slotDef, payload);
  }

  const children = cell.children?.map((child) => resolveCell(child, payload)) ?? [];
  return createElement(Component, { key: cell.key, ...props }, ...children);
}

function resolveSection(section: OvenViewDef["sections"][number], payload: JsonValue): ReactElement {
  if (section.element === "fragment") return createElement(Fragment, { key: section.key }, section.text, ...section.cells.map((cell) => resolveCell(cell, payload)));
  const element = section.element ?? "section";
  const props: Record<string, unknown> = { className: section.className, ...section.props, key: section.key };
  return createElement(element, props, section.text, ...section.cells.map((cell) => resolveCell(cell, payload)));
}

export function OvenView({ def, payload }: OvenViewProps) {
  const sections = def.sections.map((section) => resolveSection(section, payload));
  if (def.shellClassName === undefined && def.bodyClassName === undefined && def.bodyId === undefined) {
    return createElement(Fragment, null, ...sections);
  }

  return createElement(
    "div",
    { className: def.shellClassName },
    createElement("main", { className: def.bodyClassName, id: def.bodyId }, ...sections),
  );
}
