import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateOvenBinding, formatOvenValue, ovenFormatRegistry, resolveOvenPointer } from "./value-runtime";
// @ts-expect-error Shared browser-safe runtime is authored as package JavaScript.
import { evaluateOvenBinding as evaluateConsoleBinding } from "../../../src/ovens/oven-value-runtime.mjs";
// @ts-expect-error Canonical grammar is package JavaScript.
import { REGISTRY } from "../../../src/ovens/dsl/oven-grammar.mjs";

type BindingCase = Readonly<{ name: string; binding: unknown; payload: unknown; item?: unknown }>;
const outcome = (run: () => unknown) => {
  try { return { status: "ok", value: run() }; }
  catch (error) { return { status: "error", class: error?.constructor?.name, message: error instanceof Error ? error.message : String(error) }; }
};

test("pointers use own properties, RFC6901 escapes, and explicit item scope", () => {
  const inherited = Object.create({ hidden: 1 });
  expect(resolveOvenPointer(inherited, "/hidden")).toBeUndefined();
  expect(resolveOvenPointer({ "a/b": { "c~d": 2 } }, "/a~1b/c~0d")).toBe(2);
  expect(resolveOvenPointer({ x: 1 }, "@item/x", { x: 3 })).toBe(3);
  expect(resolveOvenPointer({ x: 1 }, "/x", { x: 3 })).toBe(1);
  expect(resolveOvenPointer({ x: 1 }, "x")).toBeUndefined();
  expect(resolveOvenPointer({ "bad~2": 4 }, "/bad~2")).toBe(4);
});

test("terminal pointer admission never executes accessors or proxy traps", () => {
  let accesses = 0, traps = 0;
  const accessor = Object.create(null, { x: { enumerable: true, get() { accesses += 1; return 1; } } });
  const proxy = new Proxy({}, { get(target, key, receiver) { traps += 1; return Reflect.get(target, key, receiver); } });
  expect(resolveOvenPointer(accessor, "/x")).toBeUndefined();
  expect(resolveOvenPointer(proxy, "/x")).toBeUndefined();
  expect(() => evaluateOvenBinding({ source: "/x" }, accessor)).toThrow("JSON-safe");
  expect(accesses).toBe(0); expect(traps).toBe(0);
});

test("console authority and terminal wrapper agree on a paired JSON-safe corpus", () => {
  const cases: BindingCase[] = [
    { name: "root", binding: { source: "" }, payload: { nested: { value: 2 } } },
    { name: "slash root", binding: { source: "/" }, payload: { nested: { value: 2 } } },
    { name: "nested", binding: { source: "/nested/value" }, payload: { nested: { value: 2 } } },
    { name: "item", binding: { source: "@item/name" }, payload: {}, item: { name: "row" } },
    { name: "required missing", binding: { source: "/missing" }, payload: {} },
    { name: "optional empty", binding: { source: "/missing", optional: true }, payload: {} },
    { name: "fallback stays raw", binding: { source: "/missing", optional: true, fallback: "0012", format: "number" }, payload: {} },
    { name: "present null", binding: { source: "/value", format: "number" }, payload: { value: null } },
    { name: "non-pointer source", binding: { source: "nested" }, payload: { nested: 1 } },
    { name: "literal malformed escape", binding: { source: "/bad~2" }, payload: { "bad~2": 3 } },
    { name: "unknown format", binding: { source: "/value", format: "unknown" }, payload: { value: 1 } },
    { name: "empty format", binding: { source: "/value", format: "" }, payload: { value: 1 } },
    { name: "JSON-safe bad delta value", binding: { source: "/value", format: "delta" }, payload: { value: "bad" } },
    { name: "non-string source", binding: { source: 4 }, payload: {} },
  ];
  for (const format of REGISTRY.formats) {
    const values: Record<string, unknown> = {
      identity: { ok: true }, plain: "plain", number: "1234.6", percent: 0.125, delta: 1.25,
      "ratio-to-percent": "0.5", length: ["a", "b"], "time-only": "2020-01-02T03:04:00Z",
      "relative-age": "2020-01-02T03:04:00Z",
      "progress-headline": [{ frame: 5, frames: 10, failedFieldCount: 2, fieldCount: 8, frameDelta: -1 }],
      "last-progress-percent": [{ frame: 5, frames: 10 }], "last-failed-count": [{ failedFieldCount: 2 }],
      "last-failed-percent": [{ failedFieldCount: 2, fieldCount: 8 }], "last-frame-delta": [{ frameDelta: -1 }],
      "last-delta-percent": [{ frameDelta: -1, frames: 10 }], "index-by-id": [{ id: "x", value: 1 }],
      "telemetry-availability": { status: "blocked", blockers: ["capture"] },
    };
    cases.push({ name: `format ${format}`, binding: { source: "/value", format }, payload: { value: values[format] } });
  }
  for (const entry of cases) {
    const consoleResult = outcome(() => evaluateConsoleBinding(entry.binding, entry.payload, entry.item));
    const terminalResult = outcome(() => evaluateOvenBinding(entry.binding as never, entry.payload, entry.item));
    expect(terminalResult, entry.name).toEqual(consoleResult);
  }
});

test("console invocation paths and finite registry delegate to the shared authority", () => {
  const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
  for (const path of ["dashboard/src/oven/OvenView/OvenView.tsx", "dashboard/src/oven/runtime/log-table-adapter.ts", "dashboard/src/oven/runtime/widget-adapters.tsx"]) {
    const text = source(path);
    expect(text, path).toContain('from "../../../../src/ovens/oven-value-runtime.mjs"');
    expect(text.match(/evaluateOvenBinding\(/gu)?.length ?? 0, path).toBeGreaterThanOrEqual(1);
  }
  expect(source("dashboard/src/oven/utils/json-pointer.ts")).toContain('export { resolveOvenPointer as resolvePointer } from "../../../../src/ovens/oven-value-runtime.mjs"');
  const registry = source("dashboard/src/oven/OvenView/registries.ts");
  expect(registry).toContain('import { ovenFormatRegistry } from "../../../../src/ovens/oven-value-runtime.mjs"');
  for (const format of REGISTRY.formats) {
    const delegation = /^[a-z]+$/u.test(format) ? `${format}: ovenFormatRegistry.${format}` : `"${format}": ovenFormatRegistry["${format}"]`;
    expect(registry, format).toContain(delegation);
  }
});

test("binding missing/null/fallback semantics are closed", () => {
  expect(() => evaluateOvenBinding({ source: "/missing" }, {})).toThrow("Missing required oven binding source: /missing");
  expect(evaluateOvenBinding({ source: "/missing", optional: true }, {})).toBe("");
  expect(evaluateOvenBinding({ source: "/missing", optional: true, fallback: "raw", format: "number" }, {})).toBe("raw");
  expect(evaluateOvenBinding({ source: "/value", format: "number" }, { value: null })).toBe("");
  expect(() => evaluateOvenBinding({ source: "/value", format: "unknown" }, { value: 1 })).toThrow("Unknown oven format");
});

test("closed formats cover the grammar denominator", () => {
  expect(Object.keys(ovenFormatRegistry).sort()).toEqual([...REGISTRY.formats].sort());
  expect(formatOvenValue("identity", null)).toBeNull(); expect(formatOvenValue("plain", "x")).toBe("x");
  expect(formatOvenValue("number", "12345.6")).toBe("12,346"); expect(formatOvenValue("number", "bad")).toBe("");
  expect(formatOvenValue("percent", 0.123)).toBe("12.30%"); expect(formatOvenValue("percent", null)).toBe("");
  expect(formatOvenValue("delta", 1.2300)).toBe("1.23"); expect(formatOvenValue("delta", null)).toBe("");
  expect(formatOvenValue("ratio-to-percent", 0.25)).toBe(25); expect(formatOvenValue("ratio-to-percent", null)).toBeUndefined();
  expect(formatOvenValue("length", [1, 2])).toBe(2); expect(formatOvenValue("length", null)).toBeUndefined();
  const rows = [{ frame: 5, frames: 10, failedFieldCount: 2, fieldCount: 8, frameDelta: -1 }];
  expect(formatOvenValue("progress-headline", rows)).toBe("5/10");
  expect(formatOvenValue("last-progress-percent", rows)).toBe(50);
  expect(formatOvenValue("last-failed-count", rows)).toBe("2");
  expect(formatOvenValue("last-failed-percent", rows)).toBe(25);
  expect(formatOvenValue("last-frame-delta", rows)).toBe("1");
  expect(formatOvenValue("last-delta-percent", rows)).toBe(10);
  const indexed = formatOvenValue("index-by-id", [{ id: "x", value: 1 }]) as Record<string, unknown>;
  expect(Object.getPrototypeOf(indexed)).toBeNull(); expect(indexed.x).toEqual({ id: "x", value: 1 });
  const duplicate = formatOvenValue("index-by-id", [{ id: "x", value: 1 }, null, { id: 2 }, { id: "x", value: 2 }]) as Record<string, unknown>;
  expect(duplicate.x).toEqual({ id: "x", value: 2 }); expect(Object.keys(duplicate)).toEqual(["x"]);
  expect(formatOvenValue("telemetry-availability", { status: "comparable", fields: [] })).toEqual({ status: "comparable", reason: "" });
  expect(formatOvenValue("telemetry-availability", { status: "blocked", blockers: ["a", "b"] })).toEqual({ status: "blocked", reason: "a · b" });
  expect(formatOvenValue("telemetry-availability", null)).toEqual({ status: "unavailable", reason: "Changed is unavailable until comparable transition telemetry is published." });
});

test("time formats preserve frozen-now console behavior", () => {
  const original = Date.now; Date.now = () => Date.parse("2020-01-02T05:04:00Z");
  try { expect(formatOvenValue("relative-age", "2020-01-02T03:04:00Z")).toBe("2h"); expect(String(formatOvenValue("time-only", "2020-01-02T03:04:00Z"))).toMatch(/^\d{2}:\d{2}$/); }
  finally { Date.now = original; }
});
