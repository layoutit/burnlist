import { useMemo } from "react";
import { imageGlyphFrame } from "./image-glyph-grid";
import { decodePngDataUri } from "./png-glyph";
import { fitText } from "./theme";
import { useTerminalPalette } from "./terminal-accessibility";
import { nativeImageMode } from "./native-image-capability";
import "./glyph-surface";

export function GlyphImage({ source, width, height }: { source: string | null; width: number; height: number }) {
  const palette = useTerminalPalette();
  const result = useMemo(() => {
    if (!source) return { frame: null, error: "not captured" };
    try {
      return { frame: imageGlyphFrame(decodePngDataUri(source), width, height), error: null };
    } catch (cause) {
      return { frame: null, error: cause instanceof Error ? cause.message : "invalid image" };
    }
  }, [height, source, width]);
  if (!result.frame) return <box width={width} height={height} alignItems="center" justifyContent="center"><text fg={palette.dim}>{fitText(result.error, width).trimEnd()}</text></box>;
  const native = Boolean(source) && nativeImageMode(process.env) === "iterm";
  return <box width={width} height={height}>
    <glyphSurface frame={result.frame} width={result.frame.cols} height={result.frame.rows} />
    {native ? <image source={source!} protocol="iterm" position="absolute" left={0} top={0} width={width} height={height} /> : null}
  </box>;
}
