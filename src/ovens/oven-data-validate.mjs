import "./built-in-handlers.mjs";
import { compileOven } from "./dsl/oven-compile.mjs";
import { getOvenHandler, OVEN_DATA_INPUT } from "./oven-registry.mjs";

export const SHAPE_ONLY_WARNING = "shape-only validation checks source pointers, not payload truth.";

const missing = Symbol("missing Oven source");

function result(ok, authority, payload, errors, warnings = []) {
  return {
    ok,
    authority,
    ...(ok ? { payload } : {}),
    errors,
    warnings,
  };
}

function runtimeErrors(error) {
  if (Array.isArray(error?.issues) && error.issues.length > 0) {
    return error.issues.map((issue) => ({
      path: typeof issue?.path === "string" ? issue.path : "$",
      message: String(issue?.message ?? "Runtime validation failed."),
    }));
  }
  return [{
    path: "$",
    message: String(error?.message ?? error ?? "Runtime validation failed."),
  }];
}

function resolvePointer(payload, pointer) {
  if (pointer === "" || pointer === "/" || pointer === "@item") return payload;
  const source = pointer.startsWith("@item/") ? pointer.slice(5) : pointer;
  if (!source.startsWith("/")) return missing;
  const segments = source.slice(1).split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let value = payload;
  for (const segment of segments) {
    if (value === null || value === undefined
      || (typeof value !== "object" && typeof value !== "function")
      || !Object.hasOwn(value, segment)) return missing;
    value = value[segment];
  }
  return value;
}

function sourceValues(pointer, payload, itemContexts) {
  if (typeof pointer !== "string") return [];
  if (pointer.startsWith("@item")) {
    if (!itemContexts) return [];
    return itemContexts.map(({ value, label }) => ({
      value: resolvePointer(value, pointer),
      label,
    }));
  }
  return [{ value: resolvePointer(payload, pointer), label: null }];
}

function sourceErrors(ir, payload) {
  const errors = [];
  const errorKeys = new Set();
  const nodes = [];
  const collect = (node) => {
    nodes.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  for (const node of ir.root) collect(node);
  const controls = new Map(nodes.flatMap((node) => typeof node?.attributes?.id === "string"
    ? [[node.attributes.id, node]]
    : []));

  function addError(path, message) {
    const key = `${path}\0${message}`;
    if (errorKeys.has(key)) return;
    errorKeys.add(key);
    errors.push({ path, message });
  }

  function scopedValues(pointer, contexts, itemOnly = false) {
    return (contexts ?? []).map(({ value, label }) => ({
      value: itemOnly && !pointer.startsWith("@item") ? missing : resolvePointer(value, pointer),
      label,
    }));
  }

  function rootValues(pointer) {
    return [{
      value: pointer.startsWith("@item") ? missing : resolvePointer(payload, pointer),
      label: null,
    }];
  }

  function wrapperValues(pointer, itemContexts) {
    return (itemContexts ?? []).map(({ value, label }) => ({
      value: resolvePointer({ __ovenRoot: payload, __ovenItem: value }, pointer),
      label,
    }));
  }

  function check(pointer, itemContexts, {
    optional = false,
    array = false,
    mode = "contextual",
  } = {}) {
    if (typeof pointer !== "string") return [];
    const values = mode === "root"
      ? rootValues(pointer)
      : mode === "scoped"
        ? scopedValues(pointer, itemContexts)
        : mode === "wrapper"
          ? wrapperValues(pointer, itemContexts)
        : mode === "item-only"
          ? scopedValues(pointer, itemContexts, true)
          : sourceValues(pointer, payload, itemContexts);
    for (const resolved of values) {
      if (resolved.value === missing) {
        if (optional && !array) continue;
        addError(pointer, resolved.label === null
          ? "Oven source pointer does not resolve in the payload."
          : `Oven source pointer does not resolve for ${resolved.label}.`);
      } else if (array && !Array.isArray(resolved.value)) {
        addError(pointer, resolved.label === null
          ? "Oven source pointer must resolve to an array."
          : `Oven source pointer must resolve to an array for ${resolved.label}.`);
      }
    }
    return values;
  }

  function itemValues(pointer) {
    if (typeof pointer !== "string") return [];
    const contexts = [];
    for (const resolved of rootValues(pointer)) {
      if (!Array.isArray(resolved.value)) continue;
      resolved.value.forEach((value, index) => contexts.push({
        value,
        label: `collection item ${index}`,
      }));
    }
    return contexts;
  }

  function selectedValues(node) {
    const selectionFrom = node?.attributes?.selectionFrom;
    const source = node?.attributes?.source;
    const control = controls.get(selectionFrom);
    if (typeof selectionFrom !== "string" || control?.kind !== "domain-tabs") return null;
    if (typeof source !== "string") {
      addError("$", `<${node.kind}> selection-from requires a source pointer.`);
      return [];
    }
    const selectedMap = rootValues(source)[0]?.value;
    if (selectedMap === missing) return [];
    const tabValues = rootValues(control.attributes?.source ?? "")[0]?.value;
    const ids = (Array.isArray(tabValues) ? tabValues : [])
      .map((value) => typeof value === "string"
        ? value
        : value && typeof value === "object" && typeof value.id === "string" ? value.id : null)
      .filter((value) => value !== null);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      addError(source, "Oven selection source does not provide a selectable scope.");
      return [];
    }
    return uniqueIds.flatMap((id) => {
      const value = selectedMap !== null
        && (typeof selectedMap === "object" || typeof selectedMap === "function")
        && Object.hasOwn(selectedMap, id) ? selectedMap[id] : missing;
      if (value === missing || value === null || value === undefined) {
        addError(source, `Oven source pointer does not resolve for selection ${JSON.stringify(id)}.`);
        return [];
      }
      return [{ value, label: `selection ${JSON.stringify(id)}` }];
    });
  }

  const sourceBindings = Object.freeze({
    "burn-donut": "entries",
    "checklist-burn-panel": "data",
    "checklist-event-cards": "data",
    "checklist-ledger": "data",
    "diff-card": "cards",
    "differential-kpi-strip": "payload",
    "differential-log-table": "entries",
    "file-diff": "file",
    "frame-delta-chart": "metrics",
    "kpi-item": "value",
    "progress-chart": "history",
    "progress-donut": "percent",
    "section-header": "count",
    "waffle-metric": "metric",
  });
  const arrayBindings = new Set([
    "burn-donut:entries",
    "diff-card:cards",
    "differential-log-table:entries",
    "feed-list:feeds",
    "image-triptych:images",
    "progress-chart:history",
  ]);
  const childBindingAdapters = new Set(["domain-note", "field-list", "metric-tiles", "verdict-header"]);

  const literalBindings = Object.freeze({
    "differential-empty-state": { title: "title" },
    "kpi-item": { heading: "heading", title: "title", value: "value" },
    "kpi-strip": { ariaLabel: "ariaLabel", title: "title" },
    "progress-value": { done: "done", total: "total", percent: "percent" },
    "streaming-diff-heading": { session: "session", backHref: "backHref" },
  });

  function effectiveBindings(node) {
    if (node.kind === "frame-card") return new Map();
    const bindings = new Map();
    if (childBindingAdapters.has(node.kind)) {
      for (const child of node.children ?? []) {
        if (child.kind !== "bind" || typeof child.attributes?.prop !== "string" || bindings.has(child.attributes.prop)) continue;
        bindings.set(child.attributes.prop, child.attributes);
      }
    } else {
      for (const [prop, binding] of Object.entries(node.bindings ?? {})) bindings.set(prop, binding);
    }
    for (const [attribute, prop] of Object.entries(literalBindings[node.kind] ?? {})) {
      const pointer = node.attributes?.[attribute];
      if (typeof pointer === "string" && pointer.startsWith("/")) {
        bindings.set(prop, { source: pointer, optional: false, literal: true });
      }
    }
    const sourceProp = sourceBindings[node.kind];
    if (sourceProp && typeof node.attributes?.source === "string") {
      bindings.set(sourceProp, {
        source: node.attributes.source,
        optional: node.attributes.optional === true,
      });
    }
    for (const child of node.children ?? []) {
      if (child.kind !== "text" || typeof child.attributes?.slot !== "string"
        || typeof child.attributes?.source !== "string") continue;
      bindings.set(child.attributes.slot, {
        source: child.attributes.source,
        optional: child.attributes.optional === true,
      });
    }
    return bindings;
  }

  function checkBindings(node, itemContexts) {
    const selectionContexts = selectedValues(node);
    for (const [prop, binding] of effectiveBindings(node)) {
      check(binding?.source, selectionContexts ?? itemContexts, {
        optional: binding?.optional === true,
        array: arrayBindings.has(`${node.kind}:${prop}`),
        mode: selectionContexts !== null
          ? "scoped"
          : binding?.literal === true && itemContexts !== null
            ? "wrapper"
            : "contextual",
      });
    }
  }

  const directSources = new Set([
    "checklist-burn-panel", "checklist-event-cards", "checklist-ledger", "collection",
    "domain-note", "domain-tabs", "frame-card", "log-table", "metric-tiles",
    "model-lab-view", "refresh-status", "switch",
  ]);
  const arraySources = new Set(["collection", "domain-tabs", "log-table"]);
  const defaultRootSources = new Set([
    "checklist-burn-panel", "checklist-event-cards", "checklist-ledger", "domain-tabs", "refresh-status",
  ]);

  function visit(node, itemContexts = null) {
    const pointer = node?.attributes?.source;
    const runtimePointer = pointer ?? (defaultRootSources.has(node.kind) ? "/" : undefined);
    if (directSources.has(node.kind)) {
      check(runtimePointer, itemContexts, {
        optional: node.attributes?.optional === true && typeof node.attributes?.selectionFrom !== "string",
        array: arraySources.has(node.kind),
        mode: "root",
      });
    }
    const nestedItems = node.kind === "collection" || node.kind === "log-table"
      ? itemValues(pointer)
      : null;
    if ((node.kind === "collection" || node.kind === "log-table") && typeof node.attributes?.itemKey === "string") {
      check(node.attributes.itemKey, nestedItems, { mode: "scoped" });
    }
    if (node.kind === "column") check(pointer, itemContexts, {
      optional: node.attributes?.optional === true,
      mode: "item-only",
    });
    checkBindings(node, itemContexts);
    for (const child of node.children ?? []) {
      if (child.kind === "bind") continue;
      const entersItemScope = (node.kind === "collection" && child.kind === "each")
        || (node.kind === "log-table" && child.kind === "column");
      visit(child, entersItemScope ? nestedItems : itemContexts);
    }
  }

  for (const node of ir.root) visit(node);
  return errors;
}

function compileErrors(compiled) {
  return compiled.diagnostics.map((diagnostic) => ({
    path: diagnostic.path || "$",
    message: diagnostic.message,
    code: diagnostic.code,
  }));
}

export function validateOvenData(oven, payload, context = {}) {
  const handler = getOvenHandler(oven?.id);
  if (handler?.dataInput === OVEN_DATA_INPUT.producerManaged) {
    return result(false, "producer-managed", payload, [{
      path: "$",
      message: `Oven ${handler.id} is producer-managed and cannot accept a single JSON payload.`,
    }]);
  }
  if (handler?.dataInput === OVEN_DATA_INPUT.jsonPayload) {
    try {
      handler.validateData(payload, context);
      return result(true, "runtime", payload, []);
    } catch (error) {
      return result(false, "runtime", payload, runtimeErrors(error));
    }
  }

  const warnings = [SHAPE_ONLY_WARNING];
  const compiled = compileOven(oven?.oven ?? "", { file: `${oven?.id ?? "custom"}.oven` });
  if (!compiled.ok) return result(false, "shape-only", payload, compileErrors(compiled), warnings);
  const errors = sourceErrors(compiled.ir, payload);
  return result(errors.length === 0, "shape-only", payload, errors, warnings);
}
