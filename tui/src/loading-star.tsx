import { useTerminalLoadingGlyph } from "./loading-cadence";
import { useTerminalPalette } from "./terminal-accessibility";

export function LoadingStar({ active = true, label, phase, glyph }: { active?: boolean; label: string; phase?: number; glyph?: string }) {
  const palette = useTerminalPalette();
  const animatedGlyph = useTerminalLoadingGlyph(active && glyph === undefined, phase);
  if (!active) return null;
  return <box flexDirection="row" gap={1}>
    <text fg={palette.blue}>{glyph ?? animatedGlyph}</text>
    <text fg={palette.dim}>{label}</text>
  </box>;
}
