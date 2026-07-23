import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { createFireFrameRenderer } from "../fire-frame";
import "../glyph-surface";

export const FIXTURE_ID = "glyphcss-interactive-flame";
export const fixtureSource = "glyphcss-interactive-flame@1: e\\u0301 / \\u754c; key=right; manual-clock; reduced-motion";

type Clock = Readonly<{ now(): number; setInterval(fn: () => void, delayMs: number): unknown; clearInterval(handle: unknown): void }>;

export function FixtureFlame({ reducedMotion, clock }: { reducedMotion: boolean; clock: Clock }) {
  const [selected, setSelected] = useState(0);
  const [tick, setTick] = useState(0);
  const [render] = useState(() => createFireFrameRenderer(14, 6));
  useKeyboard((key) => { if (key.name === "right" || key.sequence === "l" || key.name === "l") setSelected(1); });
  useEffect(() => {
    if (reducedMotion) return;
    const timer = clock.setInterval(() => setTick(Math.floor(clock.now() / 120) % 4), 120);
    return () => clock.clearInterval(timer);
  }, [clock, reducedMotion]);
  const phase = reducedMotion ? 0 : tick;
  return <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingTop={1} backgroundColor="#151719">
    <text fg="#f1eee8">Glyph fixture: é 界</text>
    <text fg="#76d5ff">{selected ? "Selected · ember" : "Selected · flame"}</text>
    <glyphSurface frame={render(reducedMotion ? 0 : clock.now() / 1000)} width={14} height={6} />
    <text fg="#ffb34d">{reducedMotion ? "motion: reduced" : `motion: frame ${phase}`}</text>
    <text fg="#84888f">right/l: select ember</text>
  </box>;
}
