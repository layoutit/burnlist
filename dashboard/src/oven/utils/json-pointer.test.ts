import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePointer } from "./json-pointer";

const payload = {
  summary: { passed: 2, label: "nested" },
  rows: [{ id: "first" }, { id: "second" }],
  "a/b": { "c~d": "escaped" },
};

test("resolves nested object and array segments", () => {
  assert.equal(resolvePointer(payload, "/summary/passed"), 2);
  assert.equal(resolvePointer(payload, "/rows/1/id"), "second");
});

test("returns undefined for missing paths", () => {
  assert.equal(resolvePointer(payload, "/summary/missing"), undefined);
  assert.equal(resolvePointer(payload, "/rows/4"), undefined);
  assert.equal(resolvePointer(payload, "summary/passed"), undefined);
});

test("returns the payload for empty and root pointers", () => {
  assert.equal(resolvePointer(payload, ""), payload);
  assert.equal(resolvePointer(payload, "/"), payload);
});

test("decodes RFC6901 escaped path segments", () => {
  assert.equal(resolvePointer(payload, "/a~1b/c~0d"), "escaped");
});
