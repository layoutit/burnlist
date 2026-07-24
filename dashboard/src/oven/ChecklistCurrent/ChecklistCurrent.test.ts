import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChecklistCurrent } from "./ChecklistCurrent";

const item = (id: string, loop: unknown = null) => ({ id, title: `Item ${id}`, fields: {}, loop });

test("keeps the canonical current item's Loop while another item is inspected", () => {
  const run: any = {
    itemRef: "item:list#B", loopId: "review", state: "prepared", currentNode: "implement", attempt: 0, cycle: 0,
    graph: {
      nodes: [
        { id: "implement", kind: "agent" },
        { id: "verify", kind: "check" },
        { id: "review", kind: "agent" },
        { id: "completed", kind: "terminal", terminalState: "converged" },
      ],
      edges: [
        { from: "implement", on: "complete", to: "verify" },
        { from: "verify", on: "pass", to: "review" },
        { from: "review", on: "approve", to: "completed" },
      ],
    },
  };
  const data: any = { active: [item("B", { selector: "loop:builtin:review" }), item("A")], selectedItemId: "A", loopRun: run };
  const markup = renderToStaticMarkup(createElement(ChecklistCurrent, { data }));
  assert.match(markup, /aria-label="Loop for item B"/u);
  assert.match(markup, /loop:builtin:review/u);
  assert.match(markup, /loop-compact/u);
  assert.match(markup, />R<\/b> Review/u);
  assert.doesNotMatch(markup, /Item A/u);
});

test("distinguishes direct and assigned-but-unstarted items", () => {
  const direct = renderToStaticMarkup(createElement(ChecklistCurrent, { data: { active: [item("A")], selectedItemId: "A", loopRun: null } as any }));
  const assigned = renderToStaticMarkup(createElement(ChecklistCurrent, { data: { active: [item("B", { selector: "loop:builtin:review" })], selectedItemId: "B", loopRun: null } as any }));
  assert.equal(direct, "");
  assert.match(assigned, /Assigned · not started/u);
}
);
