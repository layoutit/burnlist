import { useState } from "react";
import { useTerminalAnimation } from "./animation-governor";
import { useTerminalPalette } from "./terminal-accessibility";

const frames = ["·", "✧", "✦", "✧"];

export function LoadingStar({ label }: { label: string }) {
  const palette = useTerminalPalette();
  const [frame, setFrame] = useState(0);
  useTerminalAnimation(() => setFrame((value) => (value + 1) % frames.length), 1000 / 120);
  return <box flexDirection="row" gap={1}>
    <text fg={palette.blue}>{frames[frame]}</text>
    <text fg={palette.dim}>{label}</text>
  </box>;
}
