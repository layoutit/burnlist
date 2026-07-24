/** Descriptor-safe, iterative JSON admission used before terminal validation. */
import { types } from "node:util";

export type ResourceIssue = Readonly<{ code: string; message: string }>;
export type JsonBudget = Readonly<{ prefix: "IR" | "PAYLOAD" | "STATE"; nodes: number; depth: number; stringBytes: number; textBytes: number }>;

const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const issue = (prefix: JsonBudget["prefix"], suffix: string, message: string): ResourceIssue => ({ code: `RESOURCE_${prefix}_${suffix}`, message });

type Work = Readonly<{ value: unknown; depth: number }>;

/**
 * Inspect data properties without invoking getters or iterating attacker supplied
 * iterators. A repeated object is rejected too: JSON cannot represent aliases.
 */
export function inspectJsonBudget(value: unknown, budget: JsonBudget): ResourceIssue | null {
  const pending: Work[] = [{ value, depth: 0 }], seen = new WeakSet<object>();
  let nodes = 0, textBytes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > budget.depth) return issue(budget.prefix, "DEPTH", "JSON nesting exceeds the terminal resource limit.");
    const item = current.value;
    nodes += 1;
    if (nodes > budget.nodes) return issue(budget.prefix, "NODES", "JSON nodes exceed the terminal resource limit.");
    if (typeof item === "string") {
      const size = bytes(item);
      if (size > budget.stringBytes) return issue(budget.prefix, "STRING", "A JSON string exceeds the terminal resource limit.");
      textBytes += size;
      if (textBytes > budget.textBytes) return issue(budget.prefix, "TEXT", "JSON text exceeds the terminal resource limit.");
      continue;
    }
    if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) continue;
    if (!item || typeof item !== "object" || types.isProxy(item)) return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON.");
    if (seen.has(item)) return issue(budget.prefix, "JSON", "Terminal data must not contain cycles or aliases.");
    seen.add(item);
    let descriptors: Record<string, PropertyDescriptor>;
    try { descriptors = Object.getOwnPropertyDescriptors(item); } catch { return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON."); }
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== "string")) return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON.");
    const stringKeys = ownKeys as string[];
    const isArray = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if ((isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)) return issue(budget.prefix, "JSON", "Terminal data must be plain JSON.");
    if (isArray) {
      const length = descriptors.length;
      if (!length || !("value" in length) || length.enumerable || !Number.isSafeInteger(length.value) || length.value < 0) return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON.");
      for (const key of stringKeys) if (key !== "length" && (!/^\d+$/u.test(key) || Number(key) >= length.value || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON.");
      for (let index = length.value - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON.");
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
    } else {
      for (const key of stringKeys) {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !("value" in descriptor)) return issue(budget.prefix, "JSON", "Terminal data must be descriptor-safe JSON.");
        const size = bytes(key);
        if (size > budget.stringBytes) return issue(budget.prefix, "STRING", "A JSON key exceeds the terminal resource limit.");
        textBytes += size;
        if (textBytes > budget.textBytes) return issue(budget.prefix, "TEXT", "JSON text exceeds the terminal resource limit.");
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

export class ResourceBudgetError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "ResourceBudgetError"; }
}

/** Read a response incrementally; never hand an oversized string to JSON.parse. */
export async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResourceBudgetError("RESOURCE_HTTP_BYTES", "Response body exceeds the terminal resource limit.");
  }
  const body = response.body;
  if (!body) throw new ResourceBudgetError("RESOURCE_HTTP_JSON", "Response body is missing.");
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResourceBudgetError("RESOURCE_HTTP_BYTES", "Response body exceeds the terminal resource limit.");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged)); }
  catch { throw new ResourceBudgetError("RESOURCE_HTTP_JSON", "Response body contains malformed JSON."); }
}
