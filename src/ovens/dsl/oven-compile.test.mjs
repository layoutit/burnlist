import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileOvenFile } from "./oven-compile.mjs";

function frozen(value) { if (!value || typeof value !== "object") return true; return Object.isFrozen(value) && Object.values(value).every(frozen); }
for (const [name, expected] of Object.entries({ checklist: { components: ["kpi-item", "log-table", "progress-donut", "section-header"], icons: ["ClipboardList", "Gauge"] }, "differential-testing": { components: ["burn-donut", "field-list", "kpi-strip", "waffle-metric"], selectors: ["changed", "non-pass"] } })) test(`${name} golden compiles to frozen JSON-safe IR`, async () => {
  const result = await compileOvenFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", `${name}.oven`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(frozen(result.ir), true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ir)), result.ir);
  for (const [key, values] of Object.entries(expected)) for (const value of values) assert.ok(result.ir.requirements[key].includes(value));
});
