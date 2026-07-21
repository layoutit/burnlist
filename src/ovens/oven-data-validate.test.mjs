import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getOvenHandler } from "./oven-registry.mjs";
import {
  SHAPE_ONLY_WARNING,
  validateOvenData,
} from "./oven-data-validate.mjs";

const customSource = (body) => `<oven id="custom-shape" version="0.1.0" contract="checklist-progress@1" theme="checklist">${body}</oven>`;

test("built-in validation dispatches through the registered runtime authority", () => {
  const payload = { schema: "plausible-but-not-runtime-valid" };
  let runtimeError;
  try {
    getOvenHandler("differential-testing").validateData(payload);
  } catch (error) {
    runtimeError = error;
  }

  const result = validateOvenData({ id: "differential-testing" }, payload);

  assert.equal(result.ok, false);
  assert.equal(result.authority, "runtime");
  assert.deepEqual(result.errors, runtimeError.issues);
  assert.deepEqual(result.warnings, []);
});

test("built-in success and producer-managed rejection are capability-driven", () => {
  const payload = { any: ["JSON", "shape"] };
  assert.deepEqual(validateOvenData({ id: "checklist" }, payload), {
    ok: true,
    authority: "runtime",
    payload,
    errors: [],
    warnings: [],
  });

  const producer = validateOvenData({ id: "streaming-diff" }, payload);
  assert.equal(producer.ok, false);
  assert.equal(producer.authority, "producer-managed");
  assert.match(producer.errors[0].message, /producer-managed.*single JSON payload/u);
});

test("custom Ovens receive shape-only pointer validation", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <stack>
        <kpi-item heading="Summary"><progress-donut source="/summary/~0value"/></kpi-item>
        <section-header title="Details"><bind prop="count" source="/rows/0/~1count"/></section-header>
      </stack>`),
  };
  const payload = { summary: { "~value": 2 }, rows: [{ "/count": 1 }] };

  assert.deepEqual(validateOvenData(oven, payload), {
    ok: true,
    authority: "shape-only",
    payload,
    errors: [],
    warnings: [SHAPE_ONLY_WARNING],
  });

  const missing = validateOvenData(oven, { summary: { "~value": 2 }, rows: [{}] });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors, [{
    path: "/rows/0/~1count",
    message: "Oven source pointer does not resolve in the payload.",
  }]);
});

test("custom item pointers resolve against each collection item", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <collection id="rows" source="/rows" item-key="/id" paging="client" page-size="10">
        <each><kpi-item heading="Value" source="@item/value"/></each>
      </collection>`),
  };

  assert.equal(validateOvenData(oven, { rows: [{ id: "a", value: 1 }] }).ok, true);
  assert.deepEqual(validateOvenData(oven, { rows: [{ id: "a" }] }).errors, [{
    path: "@item/value",
    message: "Oven source pointer does not resolve for collection item 0.",
  }]);
  assert.equal(validateOvenData(oven, { rows: [] }).ok, true);
});

test("invalid custom RFC 6901 sources return structured compile errors", () => {
  const result = validateOvenData({
    id: "custom-shape",
    oven: customSource('<progress-donut source="/bad~2pointer"/>'),
  }, {});

  assert.equal(result.ok, false);
  assert.equal(result.authority, "shape-only");
  assert.ok(result.errors.some((error) => error.code === "SCALAR_POINTER"));
  assert.deepEqual(result.warnings, [SHAPE_ONLY_WARNING]);
});

test("the dispatcher contains no schema validation or per-Oven id table", () => {
  const source = readFileSync(fileURLToPath(new URL("./oven-data-validate.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /data\.schema|json[ -]?schema/iu);
  for (const id of ["differential-testing", "model-lab", "performance-tracing", "visual-parity"]) {
    assert.equal(source.includes(id), false, id);
  }
});
