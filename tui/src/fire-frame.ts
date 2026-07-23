import {
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  buildRasterizeContext,
  cloneCellGrid,
  conePolygons,
  createGlyphOrthographicCamera,
  parseGlyphEffectColor,
  rasterizeToCells,
  type CellGrid,
  type GlyphEffectImageView,
  type GlyphEffectOutput,
} from "glyphcss";
import {
  GlyphFieldSynthEffect,
  defaultGlyphEffectParams,
} from "@glyphcss/effects";

const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

function packColor(color: string | null): number {
  return color === null ? GlyphEffectNoColor : parseGlyphEffectColor(color).packed;
}

function unpackColor(color: number): string | null {
  return color === GlyphEffectNoColor ? null : `#${color.toString(16).padStart(6, "0")}`;
}

function coverageThreshold(col: number, row: number): number {
  return (bayer4[(row % 4) * 4 + (col % 4)]! + 0.5) / 16;
}

function baseFire(cols: number, rows: number): CellGrid {
  const polygons = conePolygons({
    center: [0, 0, 0],
    radius: 68,
    height: 270,
    sides: 20,
    color: "#ff481f",
  });
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: -90, zoom: 2 });
  return rasterizeToCells(buildRasterizeContext({
    camera,
    grid: { cols, rows, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    smoothShading: true,
    doubleSided: true,
    ambientLight: { color: "#ff8a2b", intensity: 0.7 },
    directionalLight: { color: "#fff0b3", direction: [-0.4, -0.8, 0.5], intensity: 1 },
  }));
}

function fireParams(time: number): Record<string, string | number | boolean> {
  const defaults = defaultGlyphEffectParams(GlyphFieldSynthEffect);
  const lava = GlyphFieldSynthEffect.presets?.find((entry) => entry.name === "Lava")?.params ?? {};
  return {
    ...defaults,
    ...lava,
    time,
    space: "scene",
    field1: "noise",
    wave1: "sin",
    freq1: 5,
    speed1: 1.8,
    amp1: 1,
    field2: "linearY",
    wave2: "saw",
    freq2: 2.5,
    speed2: -1.2,
    amp2: 0.7,
    amp3: 0,
    combine: "add",
    gain: 1.8,
    bias: 0.04,
    scale: 2.4,
    glyphs: "    .:;+=xX#%@",
    color: "#ff3214",
    colorB: "#ffe56b",
    gradient: 1,
    lit: 0.35,
  };
}

export function createFireFrameRenderer(cols = 20, rows = 12) {
  const baseGrid = baseFire(cols, rows);
  const length = cols * rows;
  const baseCoverage = Float32Array.from(baseGrid.depth, (depth) => Number.isFinite(depth) ? 1 : 0);
  const baseColor = Uint32Array.from(baseGrid.color, packColor);
  const base = {
    cols,
    rows,
    length,
    glyph: baseGrid.char,
    coverage: baseCoverage,
    color: baseColor,
    depth: baseGrid.depth,
    shade: baseGrid.shade,
    worldPosition: baseGrid.worldPosition,
    normal: baseGrid.normal,
    uv0: baseGrid.surfaceUv,
  };
  const input: GlyphEffectImageView = base;
  const target = { coverage: baseCoverage };

  return (time: number): CellGrid => {
    const params = fireParams(time);
    GlyphFieldSynthEffect.program.validateParams?.(params as never);
    const output: GlyphEffectOutput = {
      glyph: new Array(length).fill(" "),
      color: new Uint32Array(length).fill(GlyphEffectNoColor),
      coverage: new Float32Array(length),
      channels: new Uint8Array(length),
    };
    GlyphFieldSynthEffect.program.evaluate({
      params: params as never,
      state: undefined,
      base,
      input,
      target,
      coordinates: {
        cellToSceneGrid: [1, 0, 0, 1, 0, 0],
        sceneGridSize: [cols, rows],
        localCellFootprint: [1, 1],
      },
      scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
      output,
    });

    const frame = cloneCellGrid(baseGrid);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        if (baseCoverage[index] <= 0) continue;
        const visible = output.coverage[index] >= 1
          || output.coverage[index] > coverageThreshold(col, row);
        if (!visible) {
          frame.char[index] = " ";
          frame.color[index] = null;
          continue;
        }
        const channels = output.channels[index]!;
        if (channels & GlyphEffectOutputChannel.Glyph) frame.char[index] = output.glyph[index]!;
        if (channels & GlyphEffectOutputChannel.Color) frame.color[index] = unpackColor(output.color[index]!);
      }
    }
    return frame;
  };
}
