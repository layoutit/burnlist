import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { orderedSemanticText, TerminalAccessibilityProvider } from "./terminal-accessibility";
import {
  bucketTerminalSeries,
  TerminalSeriesChart,
  terminalSeriesChartFrame,
  terminalSeriesRasterSize,
  type TerminalChartPoint,
} from "./terminal-line-chart";

const points: TerminalChartPoint[] = [
  { label: "F0", value: 0, state: "pass" },
  { label: "F1", value: 0.1, state: "pass" },
  { label: "F2", value: 0.8, state: "fail" },
  { label: "F3", value: -0.4, state: "fail" },
  { label: "F4", value: 0.2, state: "pass" },
  { label: "F5", value: 0, state: "pass" },
];
const colors = { green: "#00ff00", red: "#ff0000", dim: "#666666", muted: "#999999" };

async function capture(width: number, height: number, color: "truecolor" | "none") {
  const setup = await createTestRenderer({ width, height, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={{ color, light: false, reducedMotion: true }}>
        <TerminalSeriesChart points={points} title="Exact delta" width={width} height={height} />
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return { text: orderedSemanticText(setup.captureCharFrame()), spans: setup.captureSpans() };
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

describe("terminal supersampled series chart", () => {
  test("renders a bounded continuous Braille path at 2x4 dot resolution", () => {
    const frame = terminalSeriesChartFrame(points, 48, 8, colors), text = frame.char.join("");
    expect(frame.cols).toBe(48);
    expect(frame.rows).toBe(8);
    expect(terminalSeriesRasterSize(48, 8)).toEqual({ cols: 48, rows: 8, dotWidth: 96, dotHeight: 32 });
    expect(text).not.toMatch(/[│┼]/u);
    expect(text).not.toMatch(/F0|F5|-?\\d+\\.\\d+/u);
    expect(text).toMatch(/[\u2801-\u28ff]/u);
    expect(text).not.toMatch(/[█▁▂▃▄▅▆▇]/u);
    expect(text).not.toMatch(/[╱╲]/u);
    expect(frame.color).toContain("#61d394");
    expect(frame.color).toContain("#ef4444");
  });

  test("an all-zero delta series keeps the shared symmetric baseline in the plot", () => {
    const frame = terminalSeriesChartFrame([
      { label: "F0", value: 0, state: "pass" },
      { label: "F1", value: 0, state: "pass" },
    ], 24, 6, colors);
    const rows = Array.from({ length: frame.rows }, (_, row) => frame.char.slice(row * frame.cols, (row + 1) * frame.cols).join(""));
    expect(rows.slice(2, 4).join("")).toMatch(/[\u2801-\u28ff]/u);
    expect(frame.color).toContain("#61d394");
  });

  test("narrow bucketing preserves order, extrema, and failures", () => {
    const many = Array.from({ length: 30 }, (_, index): TerminalChartPoint => ({
      label: `F${index}`,
      value: index === 7 ? 9 : index === 22 ? -8 : index / 30,
      state: index === 13 ? "fail" : "pass",
    }));
    const bucketed = bucketTerminalSeries(many, 8);
    expect(bucketed).toHaveLength(8);
    expect(bucketed.map((point) => point.value)).toContain(9);
    expect(bucketed.map((point) => point.value)).toContain(-8);
    expect(bucketed.some((point) => point.state === "fail")).toBe(true);
    expect(bucketed.map((point) => Number(point.label.slice(1)))).toEqual([...bucketed.map((point) => Number(point.label.slice(1)))].sort((a, b) => a - b));
  });

  test("wide and narrow OpenTUI surfaces remain bounded; NO_COLOR keeps geometry", async () => {
    const wide = await capture(48, 9, "truecolor"), narrow = await capture(24, 4, "truecolor");
    expect(wide.text.join("\n")).toContain("Exact delta");
    expect(narrow.text.join("\n")).toContain("Exact delta");
    expect(wide.text.slice(9).join("").trim()).toBe("");
    expect(narrow.text.slice(4).join("").trim()).toBe("");
    const mono = await capture(48, 9, "none");
    expect(mono.text).toEqual(wide.text);
    const tones = (frame: typeof mono.spans) => new Set(frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString())));
    expect(tones(mono.spans).size).toBeLessThan(tones(wide.spans).size);
  });
});
