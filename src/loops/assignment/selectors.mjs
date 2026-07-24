import { RUN_REF } from "../run/run-ref.mjs";

const HEX = "[a-f0-9]{64}";
const LOOP = new RegExp(`^loop:builtin:([a-z0-9]+(?:-[a-z0-9]+)*)(?:@(er1-sha256:${HEX}))?$`, "u");
const ITEM = /^item:([0-9]{6}-[0-9]{3})#([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/u;

function reject(label, value) { throw new TypeError(`Invalid ${label}: ${String(value)}`); }

/** Parse only the closed Stage 1 Loop selector grammar. */
export function parseLoopRef(value, { allowViewSugar = false } = {}) {
  if (allowViewSugar && value === "review") return { selector: "loop:builtin:review", name: "review", executable: null };
  const match = typeof value === "string" ? LOOP.exec(value) : null;
  if (!match) reject("LoopRef", value);
  return { selector: `loop:builtin:${match[1]}`, name: match[1], executable: match[2] ?? null };
}

export function parseItemRef(value) {
  const match = typeof value === "string" ? ITEM.exec(value) : null;
  if (!match) reject("ItemRef", value);
  return { selector: value, burnlistId: match[1], itemId: match[2] };
}

// Crockford's 26 digits encode 130 bits. Canonical ULIDs reserve the top two.
export function parseRunRef(value) {
  if (typeof value !== "string" || !RUN_REF.test(value)) reject("RunRef", value);
  return { selector: value, id: value.slice(4) };
}

export function selectorKind(value, options) {
  try { return parseLoopRef(value, options).selector ? "loop" : null; } catch { /* closed alternatives */ }
  try { parseItemRef(value); return "item"; } catch { /* closed alternatives */ }
  try { parseRunRef(value); return "run"; } catch { /* closed alternatives */ }
  reject("Loop selector", value);
}

export const SELECTOR_GRAMMARS = Object.freeze({
  LoopRef: LOOP,
  ItemRef: ITEM,
  RunRef: RUN_REF,
});
