import { useEffect, useMemo, useState } from "react";
import { createFireFrameRenderer } from "./fire-frame";
import "./glyph-surface";

export function GlyphFire({ width, height, fps }: { width: number; height: number; fps: number }) {
  const renderFrame = useMemo(() => createFireFrameRenderer(width, height), [width, height]);
  const [frame, setFrame] = useState(() => renderFrame(0));

  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => {
      setFrame(renderFrame((performance.now() - started) / 1000));
    }, Math.max(30, Math.round(1000 / fps)));
    return () => clearInterval(timer);
  }, [fps, renderFrame]);

  return <glyphSurface frame={frame} width={width} height={height} />;
}
