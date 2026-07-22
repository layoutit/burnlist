import { ovenId } from "./oven-contract.mjs";

// Oven handlers are code-owned adapters for declared Oven packages. A handler may
// provide dashboardEntries(ctx), serveData(ctx), and warm(ctx) with warmIntervalMs.
// serveData may write directly to ctx.res, or return a value for the server to JSON
// serialize. Context contains only the request-specific values each hook needs.
const handlers = new Map();

export const OVEN_DATA_INPUT = Object.freeze({
  jsonPayload: "json-payload",
  producerManaged: "producer-managed",
});

const dataInputs = new Set(Object.values(OVEN_DATA_INPUT));

function validateDataCapability(handler, id) {
  if (handler.dataInput === undefined) {
    if (handler.validateData !== undefined) {
      throw new Error(`Oven handler ${id} validateData requires dataInput.`);
    }
    return;
  }
  if (!dataInputs.has(handler.dataInput)) {
    throw new Error(`Oven handler ${id} dataInput must be json-payload or producer-managed.`);
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
  for (const hook of ["dashboardEntries", "serveData", "warm"]) {
    if (handler[hook] !== undefined && typeof handler[hook] !== "function") {
      throw new Error(`Oven handler ${normalizedId} ${hook} must be a function.`);
    }
  }
  validateDataCapability(handler, normalizedId);
  if (handler.warmIntervalMs !== undefined
    && (!Number.isInteger(handler.warmIntervalMs) || handler.warmIntervalMs <= 0)) {
    throw new Error(`Oven handler ${normalizedId} warmIntervalMs must be a positive integer.`);
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
