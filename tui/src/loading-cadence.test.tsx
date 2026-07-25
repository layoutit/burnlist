import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import {
  TERMINAL_LOADING_FRAMES,
  terminalLoadingGlyph,
} from "./loading-cadence";
import { TerminalSpinner } from "./catalog/component-pair-surface";
import {
  orderedSemanticText,
  TerminalAccessibilityProvider,
  type TerminalAccessibility,
} from "./terminal-accessibility";
import { TerminalChromeProvider } from "./terminal-chrome";

async function capture(phase: number, accessibility: TerminalAccessibility) {
  const setup = await createTestRenderer({ width: 32, height: 4, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(
      <TerminalAccessibilityProvider value={accessibility}>
        <TerminalChromeProvider>
          <TerminalSpinner width={32} animationPhase={phase} />
        </TerminalChromeProvider>
      </TerminalAccessibilityProvider>,
    ));
    await setup.renderOnce();
    return {
      text: orderedSemanticText(setup.captureCharFrame()).join("\n"),
      spans: setup.captureSpans(),
    };
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

describe("terminal loading cadence", () => {
  test("advances through one-cell glyphcss-consistent frames and loops", () => {
    expect(Array.from({ length: TERMINAL_LOADING_FRAMES.length }, (_, phase) => terminalLoadingGlyph(phase))).toEqual([...TERMINAL_LOADING_FRAMES]);
    expect(terminalLoadingGlyph(TERMINAL_LOADING_FRAMES.length)).toBe(TERMINAL_LOADING_FRAMES[0]);
    expect(TERMINAL_LOADING_FRAMES.every((frame) => [...frame].length === 1)).toBe(true);
  });

  test("canonical Spinner renders named phases while reduced motion freezes deterministically", async () => {
    const moving = { color: "truecolor", light: false, reducedMotion: false } as const;
    expect((await capture(0, moving)).text).toContain("· Loading result");
    expect((await capture(3, moving)).text).toContain("* Loading result");
    const reduced = { color: "none", light: false, reducedMotion: true } as const;
    const first = await capture(0, reduced), later = await capture(3, reduced);
    expect(first.text).toBe(later.text);
    expect(first.text).toContain("✦ Loading result");
  });

  test("NO_COLOR preserves the loading glyph and collapses its accent", async () => {
    const color = await capture(4, { color: "truecolor", light: false, reducedMotion: false });
    const mono = await capture(4, { color: "none", light: false, reducedMotion: false });
    expect(mono.text).toBe(color.text);
    const tones = (frame: typeof mono.spans) => new Set(frame.lines.flatMap((line) => line.spans.map((span) => span.fg.toString())));
    expect(tones(mono.spans).size).toBeLessThanOrEqual(tones(color.spans).size);
  });
});
