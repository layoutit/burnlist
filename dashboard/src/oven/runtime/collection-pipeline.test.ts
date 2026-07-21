import assert from "node:assert/strict";
import { test } from "node:test";
import { attachTransitionTelemetry, runCollection } from "./collection-pipeline";
import { resolvePointer } from "../utils/json-pointer";

const contract = "burnlist-differential-testing-data@1";
const rows = [
  { id: "first", label: "Alpha", sourceOwner: "z", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 2, passToFailCount: 0 } },
  { id: "second", label: "beta", sourceOwner: "match", failedSampleCount: 1, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 1 } },
  { id: "third", label: "alphabet", sourceOwner: "none", failedSampleCount: 0, missingSampleCount: 2, telemetry: { failToPassCount: 0, passToFailCount: 0 } },
];

test("collection pipeline searches before filters and stable changed sort", () => {
  const result = runCollection(rows, { contract, query: "a", matchFields: "/label", filter: { key: "non-pass" }, sort: { key: "changed" } }, resolvePointer);
  assert.deepEqual(result.map((item) => (item as { id: string }).id), ["second"]);
});

test("collection pipeline handles empty, missing, no-match, and multi-field search", () => {
  assert.deepEqual(runCollection(rows, { contract, query: "  ", matchFields: "/label" }, resolvePointer), rows);
  assert.equal(runCollection(rows, { contract, query: "x", matchFields: "/missing" }, resolvePointer).length, 0);
  assert.equal(runCollection(rows, { contract, query: "nope", matchFields: "/label /sourceOwner" }, resolvePointer).length, 0);
  assert.deepEqual(runCollection(rows, { contract, query: "match", matchFields: "/label /sourceOwner" }, resolvePointer).map((item) => (item as { id: string }).id), ["second"]);
});

test("changed sort excludes unchanged rows and uses source index after equal DT scores", () => {
  const tied = [...rows, { id: "fourth", label: "delta", failedSampleCount: 0, missingSampleCount: 0, telemetry: { failToPassCount: 1, passToFailCount: 1 } }];
  const result = runCollection(tied, { contract, sort: { key: "changed" } }, resolvePointer);
  assert.deepEqual(result.map((item) => (item as { id: string }).id), ["first", "second", "fourth"]);
});

test("sidecar telemetry is attached by id before a collection sort", () => {
  const result = attachTransitionTelemetry(rows, [
    { id: "first", failToPassCount: 0, passToFailCount: 0 },
    { id: "second", failToPassCount: 3, passToFailCount: 0 },
  ]);
  assert.deepEqual(
    runCollection(result, { contract, sort: { key: "changed" } }, resolvePointer).map((item) => (item as { id: string }).id),
    ["second"],
  );
});
