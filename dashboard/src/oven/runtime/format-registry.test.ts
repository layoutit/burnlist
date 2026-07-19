import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRegistry } from "../OvenView/registries";

test("static lowering formats preserve DSL semantics and handle absent values", () => {
  assert.equal(formatRegistry.plain("x"), "x");
  assert.equal(formatRegistry.number(12_345.6), "12,346");
  assert.equal(formatRegistry.number(undefined), "");
  assert.equal(formatRegistry["ratio-to-percent"](0.123), 12.3);
  assert.equal(formatRegistry["ratio-to-percent"](null), undefined);
  assert.equal(formatRegistry.length([1, 2]), 2);
  assert.equal(formatRegistry.length("ab"), 2);
  assert.equal(formatRegistry.length(undefined), undefined);
  assert.equal(formatRegistry.percent(0.123), "12.30%");
  assert.equal(formatRegistry.percent(undefined), "");
});

test("time formats are local and compact", () => {
  assert.match(String(formatRegistry["time-only"]("2020-01-02T03:04:00Z")), /^\d{2}:\d{2}$/u);
  const originalNow = Date.now;
  Date.now = () => Date.parse("2020-01-02T05:04:00Z");
  try {
    assert.equal(formatRegistry["relative-age"]("2020-01-02T03:04:00Z"), "2h");
    assert.equal(formatRegistry["relative-age"](undefined), "");
  } finally {
    Date.now = originalNow;
  }
});
