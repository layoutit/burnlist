import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { TerminalAccessibilityProvider, orderedSemanticText } from "../terminal-accessibility";
import { TerminalChromeProvider } from "../terminal-chrome";
import { TerminalComponentPair } from "./component-pair-surface";
import type { ComponentPairId } from "./component-pair-fixture";
import { componentPairViewport } from "./component-pair-live-model";

async function capture(id: ComponentPairId, width: number) {
  const height = componentPairViewport(id).height;
  const setup = await createTestRenderer({ width, height, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={{ color: "truecolor", light: false, reducedMotion: true }}>
        <TerminalChromeProvider>
          <TerminalComponentPair id={id} width={width} height={height} />
        </TerminalChromeProvider>
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return orderedSemanticText(setup.captureCharFrame());
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

describe("canonical Oven-derived component pairs", () => {
  test("chart pairs remain readable at wide and narrow component widths", async () => {
    for (const id of ["field-list-cards", "top-card"] as const) {
      const wide = (await capture(id, 72)).join("\n"), narrow = (await capture(id, 36)).join("\n");
      for (const frame of [wide, narrow]) {
        expect(frame).toMatch(id === "field-list-cards" ? /fail/iu : /Exact delta/iu);
        if (id === "field-list-cards") expect(frame).not.toMatch(/[│┼]/u);
      }
      expect(wide).toMatch(/[\u2801-\u28ff]/u);
      expect(narrow).not.toMatch(/[╱╲]/u);
    }
  });

  test("KPI and media pairs expose their component semantics at both widths", async () => {
    const cases = [
      ["kpi-strip", "Progress"],
      ["kpi-item", "68%"],
      ["metric-tiles", "Changed"],
      ["progress-donut", "68% complete"],
      ["burn-donut", "improved"],
      ["waffle-metric", "non-passing"],
      ["visual-parity-media", "Difference"],
      ["line-chart", "Exact delta by frame"],
    ] as const;
    for (const [id, expected] of cases) for (const width of [72, 36]) {
      expect((await capture(id, width)).join("\n")).toContain(expected);
    }
  });
});
