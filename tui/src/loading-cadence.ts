import { useState } from "react";
import { useTerminalAnimation } from "./animation-governor";
import { useTerminalAccessibility } from "./terminal-accessibility";

/** Single-cell, terminal-width-safe cadence shared by every loading surface. */
export const TERMINAL_LOADING_FRAMES = ["·", "×", "+", "*", "✦"] as const;
export const TERMINAL_LOADING_FPS = 5;
export const TERMINAL_LOADING_REST_PHASE = TERMINAL_LOADING_FRAMES.length - 1;
export const TERMINAL_LOADING_CAPTURE = Object.freeze({
  checkpoint: "spark",
  phase: TERMINAL_LOADING_REST_PHASE,
});

export function terminalLoadingGlyph(phase: number, reducedMotion = false): string {
  const safePhase = reducedMotion ? TERMINAL_LOADING_REST_PHASE : Math.max(0, Math.floor(phase));
  return TERMINAL_LOADING_FRAMES[safePhase % TERMINAL_LOADING_FRAMES.length]!;
}

/** Uses the bounded global animation governor; an explicit phase makes captures deterministic. */
export function useTerminalLoadingGlyph(active = true, phase?: number): string {
  const { reducedMotion } = useTerminalAccessibility();
  const [animatedPhase, setAnimatedPhase] = useState(0);
  useTerminalAnimation(
    () => setAnimatedPhase((value) => (value + 1) % TERMINAL_LOADING_FRAMES.length),
    TERMINAL_LOADING_FPS,
    active && phase === undefined && !reducedMotion,
  );
  return terminalLoadingGlyph(phase ?? animatedPhase, reducedMotion);
}
