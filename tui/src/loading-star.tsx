import { useEffect, useState } from "react";
import { useTerminalPalette } from "./terminal-accessibility";

const frames = ["·", "✧", "✦", "✧"];

export function LoadingStar({ label }: { label: string }) {
  const palette = useTerminalPalette();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 120);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);
  return <box flexDirection="row" gap={1}>
    <text fg={palette.blue}>{frames[frame]}</text>
    <text fg={palette.dim}>{label}</text>
  </box>;
}
