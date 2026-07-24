import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OvenNode } from "./OvenNode";
import { ModeToggleAdapter } from "./control-adapters";
import { initOvenState, ovenReducer, type OvenAction, type OvenIr } from "./oven-reducer";

const base: OvenIr = { contract: "test", controls: [{ id: "mode", kind: "mode-toggle", initial: "one" }, { id: "query", kind: "search", matchFields: "/name" }], collections: [{ id: "items", kind: "collection", source: "/items", searchFrom: "query", pageSize: 1 }], root: [] };
const item = (source: string) => ({ kind: "kpi-item", attributes: { heading: "item", source }, bindings: {}, children: [] });
function render(node: any, state = initOvenState(base, { items: [{ name: "first" }, { name: "second" }] })) { return renderToStaticMarkup(createElement(OvenNode, { node, ir: base, state, dispatch: () => {} })); }

test("OvenNode switch renders only its selected case", () => {
  const node: any = { kind: "switch", attributes: { modeFrom: "mode" }, children: [{ kind: "case", attributes: { value: "one" }, children: [item("/items/0/name")] }, { kind: "case", attributes: { value: "two" }, children: [item("/items/1/name")] }] };
  let state = initOvenState(base, { items: [{ name: "first" }, { name: "second" }] });
  assert.match(render(node, state), /first/); assert.doesNotMatch(render(node, state), /second/);
  state = ovenReducer(state, { type: "modeSelected", id: "mode", value: "two" }, base);
  assert.match(render(node, state), /second/); assert.doesNotMatch(render(node, state), /first/);
});

test("OvenNode collection each scopes @item and follows paging and search", () => {
  const node: any = { kind: "collection", attributes: { id: "items" }, children: [{ kind: "each", attributes: {}, children: [item("@item/name")] }] };
  let state = initOvenState(base, { items: [{ name: "first" }, { name: "second" }] });
  assert.match(render(node, state), /first/);
  state = ovenReducer(state, { type: "pageNext", collectionId: "items" }, base);
  assert.match(render(node, state), /second/);
  state = ovenReducer(state, { type: "queryChanged", id: "query", query: "second" }, base);
  assert.match(render(node, state), /second/); assert.doesNotMatch(render(node, state), /first/);
});

test("OvenNode composes LoopGraph from root and item-scoped sources", () => {
  const loopRun = {
    loopId: "review", state: "running", currentNode: "verify", attempt: 1, cycle: 0,
    graph: {
      entry: "implement",
      nodes: [{ id: "implement", kind: "agent" }, { id: "verify", kind: "check" }],
      edges: [{ from: "implement", on: "complete", to: "verify" }],
    },
    transitions: [{ sequence: 1, from: "implement", outcome: "complete", to: "verify" }],
  };
  const rootNode: any = { kind: "loop-graph", attributes: { source: "/loopRun" }, children: [] };
  assert.match(render(rootNode, initOvenState(base, { loopRun })), /aria-current="step"/);
  assert.match(render(rootNode, initOvenState(base, { loopRun })), /VERIFY/);
  const itemNode: any = {
    kind: "collection", attributes: { id: "items" },
    children: [{ kind: "each", attributes: {}, children: [{ kind: "loop-graph", attributes: { source: "@item/loopRun" }, children: [] }] }],
  };
  assert.match(render(itemNode, initOvenState(base, { items: [{ name: "first", loopRun }] })), /aria-current="step"/);
});

test("OvenNode sends mode-toggle callbacks through the closed dispatch", () => {
  const actions: OvenAction[] = [];
  const node: any = { kind: "mode-toggle", attributes: { id: "mode", ariaLabel: "Mode" }, children: [{ kind: "option", attributes: { value: "one", label: "One" } }, { kind: "option", attributes: { value: "two", label: "Two" } }] };
  const element: any = ModeToggleAdapter({ node, ir: base, state: initOvenState(base, {}), dispatch: (action) => actions.push(action) });
  const children = element.props.children;
  children[1].props.onClick();
  assert.deepEqual(actions, [{ type: "modeSelected", id: "mode", value: "two" }]);
});
