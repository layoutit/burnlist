import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyOvenRevision,
  normalizeOvenDetail,
  normalizeOvenPackage,
  ovenRevision,
} from "./oven-contract.mjs";

function packageFixture(id = "sample-oven") {
  return {
    id,
    instructions: "# Sample Oven\n\nFollow the checklist.\n",
    oven: '<oven id="sample-oven" version="1" contract="checklist-progress@1" theme="checklist">\n  <section-header title="Sample Oven"/>\n</oven>\n',
  };
}

function detailFixture() {
  return {
    version: 1,
    columns: 2,
    rows: 2,
    rowHeight: 48,
    cells: [{
      id: "summary",
      title: "Summary",
      description: "Current status.",
      widget: "metric",
      source: "/summary",
      format: "plain",
      column: 1,
      row: 1,
      columnSpan: 2,
      rowSpan: 1,
    }],
  };
}

function normalizedFixture(id) {
  return normalizeOvenPackage(packageFixture(id));
}

test("normalizeOvenDetail retains legacy detail validation", () => {
  assert.deepEqual(normalizeOvenDetail(detailFixture()), detailFixture());
});

test("id-is-part-of-revision", () => {
  assert.notEqual(ovenRevision(normalizedFixture("original-oven")), ovenRevision(normalizedFixture("forked-oven")));
});

test("content-change-changes-revision", () => {
  const original = normalizedFixture("sample-oven");
  const changedInstructions = { ...original, instructions: "# Sample Oven\n\nUse the revised checklist." };
  const changedOven = {
    ...original,
    oven: original.oven.replace("Sample Oven", "Revised Oven"),
  };
  const revision = ovenRevision(original);
  assert.notEqual(ovenRevision(changedInstructions), revision);
  assert.notEqual(ovenRevision(changedOven), revision);
});

test("key-order-invariant", () => {
  const original = normalizedFixture("sample-oven");
  const reordered = {
    oven: original.oven.replaceAll("\n", "\r\n"),
    instructions: original.instructions.replaceAll("\n", "\r\n"),
    id: original.id,
  };
  assert.equal(ovenRevision(original), ovenRevision(reordered));
});

test("legacyOvenRevision reproduces the old detail-based revision", () => {
  assert.equal(
    legacyOvenRevision({ instructions: packageFixture().instructions, detail: detailFixture() }),
    "o1-sha256:c2c96959e1dd7b5ae37893db09adef9f778a2f09fb4ea85af92bdc51964d0067",
  );
});
