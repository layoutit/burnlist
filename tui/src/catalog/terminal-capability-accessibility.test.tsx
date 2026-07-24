import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { orderedSemanticText, paletteFor, TerminalAccessibilityProvider, terminalAccessibility, type TerminalAccessibility } from "../terminal-accessibility";
import { terminalKeyAction } from "../terminal-navigation";
import { TerminalChromeProvider } from "../terminal-chrome";
import { TableCell, TableLine } from "../table-view";
import { GlyphFire } from "../glyph-fire";
import { ItemDetail } from "../item-view";
import { TerminalKpiItem } from "../oven-runtime/components/progress-components";
import { TerminalList } from "../oven-runtime/components/list-components";

async function capturedTable(accessibility: TerminalAccessibility) {
  const setup = await createTestRenderer({ width: 28, height: 2, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={accessibility}>
        <TerminalChromeProvider>
          <TableLine selected><TableCell width={28}>ACTIVE · 2 remaining</TableCell></TableLine>
        </TerminalChromeProvider>
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return { text: orderedSemanticText(setup.captureCharFrame()), frame: setup.captureSpans() };
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}
async function capturedItem(accessibility: TerminalAccessibility) {
  const setup = await createTestRenderer({ width: 48, height: 8, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={accessibility}>
        <ItemDetail item={{ key: "active:B1", kind: "active", id: "B1", title: "Keyboard reachable", status: "ACTIVE", latest: false, fields: { state: "ready" } }} width={48} />
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return { text: orderedSemanticText(setup.captureCharFrame()), frame: setup.captureSpans() };
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}
async function capturedOvenCore(accessibility: TerminalAccessibility) {
  const setup = await createTestRenderer({ width: 40, height: 8, useThread: false });
  const root = createRoot(setup.renderer);
  const visual = { kind: "progress-donut", attributes: { source: "/percent" }, bindings: {}, children: [] };
  const item = { kind: "kpi-item", attributes: { heading: "Progress", value: "/percent" }, bindings: {}, children: [visual] };
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={accessibility}>
        <TerminalChromeProvider>
          <box width={40} height={8} flexDirection="column">
            <TerminalKpiItem node={item as never} payload={{ percent: 50 }} width={16} />
            <TerminalList model={{ columns: [{ id: "state", label: "STATE" }], rows: [{ id: "one", cells: { state: "ACTIVE" }, tone: "good" }], selectedId: "one", width: 40, height: 3 }} />
          </box>
        </TerminalChromeProvider>
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return { text: orderedSemanticText(setup.captureCharFrame()), frame: setup.captureSpans() };
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

describe("terminal capability accessibility", () => {
  test("selects deterministic color and motion degradation tiers", () => {
    expect(terminalAccessibility({ COLORTERM: "truecolor" }).color).toBe("truecolor");
    expect(terminalAccessibility({ TERM: "xterm-256color" }).color).toBe("256");
    expect(terminalAccessibility({ TERM: "vt100" }).color).toBe("16");
    expect(terminalAccessibility({ COLORFGBG: "0;15" }).light).toBe(true);
    expect(terminalAccessibility({ NO_COLOR: "1", COLORFGBG: "15;0", REDUCED_MOTION: "1" })).toEqual({ color: "none", light: false, reducedMotion: true });
  });
  test("semantic rows remain ordered and sanitize terminal controls", () => {
    expect(orderedSemanticText("first  \n\u001b[2Jsecond  ")).toEqual(["first", "␛[2Jsecond"]);
  });
  test("palette tiers preserve readable foregrounds while monochrome collapses semantic tones", () => {
    expect(paletteFor({ color: "none", light: false, reducedMotion: false }).red).toBe(paletteFor({ color: "none", light: false, reducedMotion: false }).foreground);
    expect(paletteFor({ color: "16", light: false, reducedMotion: false }).red).toBe("red");
    expect(paletteFor({ color: "256", light: false, reducedMotion: false }).blue).toBe("#5fafff");
    expect(paletteFor({ color: "truecolor", light: true, reducedMotion: false }).foreground).toBe("#202124");
  });
  test("production table output preserves semantics and focus across captured palette tiers", async () => {
    const tiers = await Promise.all([
      capturedTable({ color: "truecolor", light: false, reducedMotion: false }),
      capturedTable({ color: "256", light: false, reducedMotion: false }),
      capturedTable({ color: "16", light: true, reducedMotion: false }),
      capturedTable({ color: "none", light: false, reducedMotion: true }),
    ]);
    expect(tiers.map((entry) => entry.text)).toEqual(Array(4).fill(tiers[0]!.text));
    expect(tiers[0]!.text.join("\n")).toContain("▎ ACTIVE · 2 remaining");
    const colors = tiers.map((entry) => new Set(entry.frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString()))));
    expect(colors[0]).not.toEqual(colors[1]);
    expect(colors[1]).not.toEqual(colors[2]);
    expect(colors[3]!.size).toBeLessThanOrEqual(3);
  });
  test("NO_COLOR reaches the production item detail instead of leaking legacy status RGB", async () => {
    const truecolor = await capturedItem({ color: "truecolor", light: false, reducedMotion: false });
    const monochrome = await capturedItem({ color: "none", light: false, reducedMotion: false });
    expect(monochrome.text).toEqual(truecolor.text);
    expect(monochrome.text.join("\n")).toContain("ACTIVE");
    const trueColors = new Set(truecolor.frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString())));
    const monoColors = new Set(monochrome.frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString())));
    expect(monoColors.size).toBeLessThan(trueColors.size);
  });
  test("NO_COLOR reaches production Oven glyph and selected-list foreground/background colors", async () => {
    const truecolor = await capturedOvenCore({ color: "truecolor", light: false, reducedMotion: false });
    const monochrome = await capturedOvenCore({ color: "none", light: false, reducedMotion: false });
    expect(monochrome.text).toEqual(truecolor.text);
    expect(monochrome.text.join("\n")).toContain("ACTIVE");
    const sets = (frame: typeof truecolor.frame) => ({
      fg: new Set(frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString()))),
      bg: new Set(frame.lines.flatMap((line) => line.spans.map((span) => span.bg.toString()))),
    });
    const color = sets(truecolor.frame), mono = sets(monochrome.frame);
    expect(mono.fg.size).toBeLessThan(color.fg.size);
    expect(mono.bg.size).toBeLessThanOrEqual(color.bg.size);
  });
  test("reduced motion freezes the production glyphcss fire surface", async () => {
    const setup = await createTestRenderer({ width: 12, height: 6, useThread: false });
    const root = createRoot(setup.renderer);
    try {
      flushSync(() => root.render(
        <TerminalAccessibilityProvider value={{ color: "none", light: false, reducedMotion: true }}>
          <GlyphFire width={12} height={6} fps={30} />
        </TerminalAccessibilityProvider>,
      ));
      await setup.renderOnce();
      const first = setup.captureCharFrame();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toBe(first);
    } finally {
      root.unmount();
      setup.renderer.destroy();
    }
  });
  test("q is globally reserved and escape has an explicit home-only exit invariant", () => {
    expect(terminalKeyAction("q", 3, true)).toBe("input");
    expect(terminalKeyAction("escape", 3, true)).toBe("continue");
    expect(terminalKeyAction("escape", 1, true)).toBe("continue");
    expect(terminalKeyAction("a", 3, true)).toBe("input");
  });
});
