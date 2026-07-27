import { useTerminalPalette } from "./terminal-accessibility";

export function BrandMark() {
  const palette = useTerminalPalette();
  return <box width={3} height={1} alignItems="center" justifyContent="center">
    <text fg={palette.soft}>⟁</text>
  </box>;
}
