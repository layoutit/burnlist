import { sanitizeTerminalText } from "./terminal-text";
import { createContext, createElement, useContext, type ReactNode } from "react";

export type ColorTier = "truecolor" | "256" | "16" | "none";
export type TerminalAccessibility = Readonly<{ color: ColorTier; light: boolean; reducedMotion: boolean }>;

/** Derives deterministic terminal affordances without relying on color alone. */
export function terminalAccessibility(environment: Readonly<Record<string, string | undefined>> = {}): TerminalAccessibility {
  const term = environment.TERM ?? "", colorTerm = environment.COLORTERM ?? "";
  const color: ColorTier = environment.NO_COLOR !== undefined ? "none" : /truecolor|24bit/iu.test(colorTerm) ? "truecolor" : /256color/iu.test(term) ? "256" : "16";
  const background = Number((environment.COLORFGBG ?? "").split(";").at(-1));
  return { color, light: Number.isFinite(background) && background >= 7 && background !== 8, reducedMotion: environment.TERM_REDUCED_MOTION === "1" || environment.REDUCED_MOTION === "1" };
}
const AccessibilityContext = createContext<TerminalAccessibility>({ color: "truecolor", light: false, reducedMotion: false });
export function TerminalAccessibilityProvider({ value, children }: { value: TerminalAccessibility; children: ReactNode }) { return createElement(AccessibilityContext.Provider, { value }, children); }
export function useTerminalAccessibility() { return useContext(AccessibilityContext); }
export type TerminalPalette = Readonly<{ foreground: string; soft: string; muted: string; dim: string; blue: string; green: string; red: string; amber: string }>;
export function paletteFor(accessibility: TerminalAccessibility): TerminalPalette {
  const mono = accessibility.color === "none", light = accessibility.light;
  const foreground = light ? "#202124" : "#e8e8e8", muted = light ? "#45474d" : "#a8a8a8", dim = light ? "#62656d" : "#868686";
  if (mono) return { foreground, soft: foreground, muted, dim, blue: foreground, green: foreground, red: foreground, amber: foreground };
  if (accessibility.color === "16") return { foreground, soft: foreground, muted, dim, blue: "blue", green: "green", red: "red", amber: "yellow" };
  if (accessibility.color === "256") return { foreground, soft: foreground, muted, dim, blue: "#5fafff", green: "#5fd787", red: "#ff5f5f", amber: "#ffd75f" };
  return { foreground, soft: light ? "#303136" : "#d4d4d8", muted, dim, blue: "#5aa2ff", green: "#61d394", red: "#ef7171", amber: "#fcd34d" };
}
export function useTerminalPalette() { return paletteFor(useTerminalAccessibility()); }

/** The same ordered linear surface stored in terminal-frame JSON and Storybook. */
export function orderedSemanticText(frame: string): readonly string[] {
  return frame.split("\n").map((line) => sanitizeTerminalText(line).trimEnd());
}
