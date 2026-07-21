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
  if (pointer.startsWith("@item")) {
    if (!itemContexts) return [];
    return itemContexts.map(({ value, index }) => ({
      value: resolvePointer(value, pointer),
      index,
    }));
  }
  return [{ value: resolvePointer(payload, pointer), index: null }];
}

function sourceErrors(ir, payload) {
  const errors = [];

  function check(pointer, itemContexts) {
    if (typeof pointer !== "string") return;
    for (const resolved of sourceValues(pointer, payload, itemContexts)) {
      if (resolved.value !== missing) continue;
      errors.push({
        path: pointer,
        message: resolved.index === null
          ? "Oven source pointer does not resolve in the payload."
          : `Oven source pointer does not resolve for collection item ${resolved.index}.`,
      });
    }
  }

  function itemValues(pointer, itemContexts) {
    if (typeof pointer !== "string") return [];
    const contexts = [];
    for (const resolved of sourceValues(pointer, payload, itemContexts)) {
      if (!Array.isArray(resolved.value)) continue;
      resolved.value.forEach((value, index) => contexts.push({
        value,
        index: resolved.index === null ? String(index) : `${resolved.index}.${index}`,
      }));
    }
    return contexts;
  }

  function visit(node, itemContexts = null) {
    const pointer = node?.attributes?.source;
    check(pointer, itemContexts);
    const nestedItems = node.kind === "collection" || node.kind === "log-table"
      ? itemValues(pointer, itemContexts)
      : null;
    for (const child of node.children ?? []) {
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
