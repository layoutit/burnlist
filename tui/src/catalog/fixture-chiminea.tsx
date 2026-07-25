import { useEffect, useState } from "react";
import { createChimineaFrameRenderer } from "../chiminea-frame";
import "../glyph-surface";
import { chimineaFixture } from "./chiminea-fixture";

type Clock = Readonly<{ now(): number; setInterval(fn: () => void, delayMs: number): unknown; clearInterval(handle: unknown): void }>;

export function FixtureChiminea({ reducedMotion, clock }: { reducedMotion: boolean; clock: Clock }) {
  const [render] = useState(() => createChimineaFrameRenderer(24, 12));
  const [, setTick] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = clock.setInterval(() => setTick((value) => value + 1), 120);
    return () => clock.clearInterval(timer);
  }, [clock, reducedMotion]);
  return <box width="100%" height="100%" flexDirection="column" paddingLeft={1}>
    <text fg="#f1eee8">{chimineaFixture.title}</text>
    <text fg="#84888f">glyphcss flame · {reducedMotion ? "reduced motion" : "animated"}</text>
    <glyphSurface frame={render(clock.now() / 1000, reducedMotion)} width={24} height={12} />
  </box>;
}
