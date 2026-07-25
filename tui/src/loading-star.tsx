import { useTerminalLoadingGlyph } from "./loading-cadence";
import { useTerminalPalette } from "./terminal-accessibility";

export function LoadingStar({ active = true, label, phase }: { active?: boolean; label: string; phase?: number }) {
  const palette = useTerminalPalette();
  const glyph = useTerminalLoadingGlyph(active, phase);
  if (!active) return null;
  return <box flexDirection="row" gap={1}>
    <text fg={palette.blue}>{glyph}</text>
    <text fg={palette.dim}>{label}</text>
  </box>;
}
