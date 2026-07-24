import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
// @ts-expect-error Production compiler remains JavaScript.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
import { differentialFixture } from "../catalog/differential-fixture";
import { visualParityFixture } from "../catalog/visual-parity-fixture";
import { terminalKeyboardAction, terminalSearchControl } from "./keyboard-runtime";
import { initTerminalRuntime, reduceTerminalRuntime } from "./state-runtime";
import type { TerminalOvenIR } from "./terminal-contract";

function official(name: string): TerminalOvenIR {
  const source = readFileSync(new URL(`../../../ovens/${name}/${name}.oven`, import.meta.url), "utf8");
  const result = compileOven(source, { file: `${name}.oven` });
  if (!result.ok) throw new Error(`${name} did not compile`);
  return result.ir;
}

test("generic keyboard actions select and expand collection rows without an Oven-id branch", () => {
  const ir = official("differential-testing");
  let state = initTerminalRuntime(ir, differentialFixture.payload);
  const move = terminalKeyboardAction("down", ir, state);
  expect(move).toEqual({ type: "selectionMoved", collectionId: "field-view", direction: 1 });
  state = reduceTerminalRuntime(state, move!, ir);
  expect(state.selections["field-view"]).toBe("active");
  state = reduceTerminalRuntime(state, terminalKeyboardAction("enter", ir, state)!, ir);
  expect(state.expandedKeys).toEqual(["field-view:active"]);
  expect(terminalKeyboardAction("m", ir, state)).toEqual({ type: "modeSelected", id: "progress-mode", value: "progress" });
  expect(terminalSearchControl(ir)?.id).toBe("field-search");
});

test("generic keyboard actions cycle declarative domain controls", () => {
  const ir = official("visual-parity");
  const state = initTerminalRuntime(ir, visualParityFixture.payload);
  expect(terminalKeyboardAction("right", ir, state)).toEqual({ type: "domainSelected", id: "domain-select", value: "mobile" });
});

