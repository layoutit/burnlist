import { useMemo } from "react";
import { supersampleImage } from "./image-supersample";
import { decodePngDataUri } from "./png-glyph";
import { fitText, palette } from "./theme";
import "./supersample-surface";

export function GlyphImage({ source, width, height }: { source: string | null; width: number; height: number }) {
  const result = useMemo(() => {
    if (!source) return { frame: null, error: "not captured" };
    try {
      return { frame: supersampleImage(decodePngDataUri(source), width, height), error: null };
    } catch (cause) {
      return { frame: null, error: cause instanceof Error ? cause.message : "invalid image" };
    }
  }, [height, source, width]);
  if (!result.frame) return <box width={width} height={height} alignItems="center" justifyContent="center"><text fg={palette.dim}>{fitText(result.error, width).trimEnd()}</text></box>;
  return <supersampleSurface frame={result.frame} width={result.frame.cols} height={result.frame.rows} />;
}
