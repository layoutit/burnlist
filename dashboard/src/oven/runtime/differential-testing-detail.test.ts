import assert from "node:assert/strict";
import { test } from "node:test";
import { DifferentialTestingDetail } from "./differential-testing-detail";

type ElementLike = {
  props?: Record<string, unknown> & { children?: unknown };
};

function progressButtons(node: unknown, found = new Map<string, ElementLike>()): Map<string, ElementLike> {
  if (Array.isArray(node)) {
    for (const child of node) progressButtons(child, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const element = node as ElementLike;
  const mode = element.props?.["data-progress-chart-mode"];
  if (typeof mode === "string") found.set(mode, element);
  progressButtons(element.props?.children, found);
  return found;
}

test("Differential Testing progress controls publish each selected mode", () => {
  const selected: string[] = [];
  const tree = DifferentialTestingDetail({
    payload: {},
    progressMode: "delta",
    onProgressModeChange: (mode) => selected.push(mode),
    refresh: null,
    kpis: null,
    chart: null,
    log: null,
  });
  const buttons = progressButtons(tree);

  assert.deepEqual([...buttons.keys()], ["progress", "failed", "delta"]);
  for (const mode of ["progress", "failed", "delta"] as const) {
    const onClick = buttons.get(mode)?.props?.onClick;
    assert.equal(typeof onClick, "function");
    (onClick as () => void)();
  }
  assert.deepEqual(selected, ["progress", "failed", "delta"]);
});
