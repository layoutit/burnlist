import { useMemo, useRef, useState } from "react";
import { useTerminalAnimation } from "./animation-governor";
import { useTerminalAccessibility } from "./terminal-accessibility";
import { createFireFrameRenderer } from "./fire-frame";
import { fitGlyphGridSize } from "./glyph-frame-bounds";
import "./glyph-surface";

export function GlyphFire({ width, height, fps }: { width: number; height: number; fps: number }) {
  const reduced = useTerminalAccessibility().reducedMotion;
  const grid = useMemo(() => fitGlyphGridSize(width, height), [width, height]);
  const renderFrame = useMemo(() => createFireFrameRenderer(grid.cols, grid.rows), [grid]);
  const [frame, setFrame] = useState(() => renderFrame(0));
  const started = useRef(performance.now());

  useTerminalAnimation(() => setFrame(renderFrame((performance.now() - started.current) / 1000)), fps, !reduced);

  return <glyphSurface frame={frame} width={grid.cols} height={grid.rows} />;
}
