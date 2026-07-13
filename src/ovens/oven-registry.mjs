import { ovenId } from "./oven-contract.mjs";

// Oven handlers are code-owned adapters for declared Oven packages. A handler may
// provide dashboardEntries(ctx), serveData(ctx), and warm(ctx) with warmIntervalMs.
// serveData may write directly to ctx.res, or return a value for the server to JSON
// serialize. Context contains only the request-specific values each hook needs.
const handlers = new Map();

export function registerOvenHandler(id, handler) {
  const normalizedId = ovenId(id);
  if (!handler || typeof handler !== "object") throw new Error(`Oven handler for ${normalizedId} must be an object.`);
  if (handlers.has(normalizedId)) throw new Error(`Oven handler for ${normalizedId} is already registered.`);
  handlers.set(normalizedId, handler);
  return handler;
}

export function getOvenHandler(id) {
  return handlers.get(id) ?? null;
}

export function listOvenHandlers() {
  return [...handlers.values()];
}
