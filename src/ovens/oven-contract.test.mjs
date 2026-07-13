import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOvenPackage, ovenRevision } from "./oven-contract.mjs";

function packageFixture(id = "sample-oven") {
  return {
    id,
    instructions: "# Sample Oven\n\nFollow the checklist.\n",
    detail: {
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
    },
  };
}

function normalizedFixture(id) {
  return normalizeOvenPackage(packageFixture(id));
}

test("unmodified-fork-shares-revision", () => {
  assert.equal(ovenRevision(normalizedFixture("original-oven")), ovenRevision(normalizedFixture("forked-oven")));
});

test("content-change-changes-revision", () => {
  const original = normalizedFixture("sample-oven");
  const changedInstructions = { ...original, instructions: "# Sample Oven\n\nUse the revised checklist." };
  const changedTitle = {
    ...original,
    detail: { ...original.detail, cells: [{ ...original.detail.cells[0], title: "Revised summary" }] },
  };
  const changedVersion = { ...original, detail: { ...original.detail, version: 2 } };
  const revision = ovenRevision(original);
  assert.notEqual(ovenRevision(changedInstructions), revision);
  assert.notEqual(ovenRevision(changedTitle), revision);
  assert.notEqual(ovenRevision(changedVersion), revision);
});

test("key-order-invariant", () => {
  const original = normalizedFixture("sample-oven");
  const reordered = {
    id: "other-oven",
    instructions: original.instructions.replaceAll("\n", "\r\n"),
    detail: {
      cells: original.detail.cells.map((cell) => ({ rowSpan: cell.rowSpan, title: cell.title, id: cell.id, ...cell })),
      rowHeight: original.detail.rowHeight,
      rows: original.detail.rows,
      columns: original.detail.columns,
      version: original.detail.version,
    },
  };
  assert.equal(ovenRevision(original), ovenRevision(reordered));
});
