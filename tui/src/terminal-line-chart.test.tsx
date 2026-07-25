import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { orderedSemanticText, TerminalAccessibilityProvider } from "./terminal-accessibility";
import { TerminalLineChart, terminalLineChartFrame, type TerminalChartPoint } from "./terminal-line-chart";

const points: TerminalChartPoint[] = [
  { label: "F0", value: 0, state: "pass" },
  { label: "F1", value: 0.1, state: "pass" },
  { label: "F2", value: 0.8, state: "fail" },
  { label: "F3", value: 0.2, state: "fail" },
  { label: "F4", value: 0, state: "pass" },
];
const colors = { green: "#00ff00", red: "#ff0000", dim: "#666666", muted: "#999999" };

async function capture(width: number, height: number, color: "truecolor" | "none") {
  const setup = await createTestRenderer({ width, height, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={{ color, light: false, reducedMotion: true }}>
        <TerminalLineChart points={points} title="Exact delta" width={width} height={height} />
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return { text: orderedSemanticText(setup.captureCharFrame()), spans: setup.captureSpans() };
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

describe("terminal line chart", () => {
  test("rasterizes bounded axes and continuous green/red path segments", () => {
    const frame = terminalLineChartFrame(points, 48, 6, colors);
    expect(frame.cols).toBe(48);
    expect(frame.rows).toBe(6);
    expect(frame.char.join("")).toContain("│");
    expect(frame.char.join("")).toContain("└");
    expect(frame.char.join("")).toContain("●");
    expect(frame.char.join("")).toMatch(/[╱╲─]/u);
    expect(frame.color).toContain(colors.green);
    expect(frame.color).toContain(colors.red);
    expect(frame.char.join("").length).toBe(frame.cols * frame.rows);
  });

  test("wide axes and narrow sparkline retain labels without overflow", async () => {
    const wide = await capture(48, 8, "truecolor"), narrow = await capture(24, 4, "truecolor");
    expect(wide.text.join("\n")).toContain("Exact delta");
    expect(wide.text.join("\n")).toContain("passing path");
    expect(wide.text.join("\n")).toContain("failing path");
    expect(narrow.text.join("\n")).toContain("Exact delta");
    expect(narrow.text.join("\n")).toContain("pass");
    expect(narrow.text.join("\n")).toContain("fail");
    expect(wide.text.slice(8).join("").trim()).toBe("");
    expect(narrow.text.slice(4).join("").trim()).toBe("");
  });

  test("NO_COLOR keeps chart geometry while collapsing semantic tones", async () => {
    const color = await capture(48, 8, "truecolor"), mono = await capture(48, 8, "none");
    expect(mono.text).toEqual(color.text);
    const tones = (frame: typeof mono.spans) => new Set(frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString())));
    expect(tones(mono.spans).size).toBeLessThan(tones(color.spans).size);
  });
});
