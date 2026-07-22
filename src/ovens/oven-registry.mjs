import { ovenId } from "./oven-contract.mjs";

// Oven handlers are code-owned adapters for declared Oven packages. A handler may
// provide dashboardEntries(ctx), serveData(ctx), and reconcileDataBindings(ctx).
// serveData may write directly to ctx.res, or return a value for the server to JSON
// serialize. Context contains only the request-specific values each hook needs.
const handlers = new Map();

export const OVEN_DATA_INPUT = Object.freeze({
  jsonPayload: "json-payload",
  producerManaged: "producer-managed",
});

const dataInputs = new Set(Object.values(OVEN_DATA_INPUT));
const contractPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*@[1-9][0-9]*$/u;

function validateDataCapability(handler, id) {
  if (handler.dataInput === undefined) {
    if (handler.validateData !== undefined || handler.inputContract !== undefined) {
      throw new Error(`Oven handler ${id} inputContract and validateData require dataInput.`);
    }
    return;
  }
  if (!dataInputs.has(handler.dataInput)) {
    throw new Error(`Oven handler ${id} dataInput must be json-payload or producer-managed.`);
  }
  if (typeof handler.inputContract !== "string" || !contractPattern.test(handler.inputContract)) {
    throw new Error(`Oven handler ${id} dataInput requires a versioned inputContract.`);
  }
  if (handler.dataInput === OVEN_DATA_INPUT.jsonPayload && typeof handler.validateData !== "function") {
    throw new Error(`Oven handler ${id} json-payload dataInput requires validateData.`);
  }
  if (handler.dataInput === OVEN_DATA_INPUT.producerManaged && handler.validateData !== undefined) {
    throw new Error(`Oven handler ${id} producer-managed dataInput cannot expose validateData.`);
  }
}

export function registerOvenHandler(id, handler) {
  const normalizedId = ovenId(id);
  if (!handler || typeof handler !== "object") throw new Error(`Oven handler for ${normalizedId} must be an object.`);
  if (handlers.has(normalizedId)) throw new Error(`Oven handler for ${normalizedId} is already registered.`);
  if (handler.id !== id) throw new Error(`Oven handler id must equal its registry key ${normalizedId}.`);
  for (const hook of ["dashboardEntries", "serveData", "reconcileDataBindings"]) {
    if (handler[hook] !== undefined && typeof handler[hook] !== "function") {
      throw new Error(`Oven handler ${normalizedId} ${hook} must be a function.`);
    }
  }
  validateDataCapability(handler, normalizedId);
  if (handler.warm !== undefined || handler.warmIntervalMs !== undefined) {
    throw new Error(`Oven handler ${normalizedId} warming is retired; canonical snapshots refresh lazily.`);
  }
  const registered = Object.freeze({ ...handler, id: normalizedId });
  handlers.set(normalizedId, registered);
  return registered;
}

export function getOvenHandler(id) {
  return handlers.get(id) ?? null;
}

export function listOvenHandlers() {
  return [...handlers.values()];
}
