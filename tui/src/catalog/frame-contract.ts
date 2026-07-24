export const FRAME_SCHEMA = "burnlist-terminal-frame@1" as const;
export const FRAME_INDEX_SCHEMA = "burnlist-terminal-frame-index@1" as const;

export type FrameCell = Readonly<{
  char: string;
  fg: number;
  bg: number;
  attributes: number;
  continuation: boolean;
}>;

export type RendererProvenance = Readonly<{
  sourceSha256: string;
  bun: Readonly<{ runtimeVersion: string; packageVersion: string; integrity: string }>;
  packages: Readonly<Record<string, Readonly<{ version: string; integrity: string }>>>;
}>;

export type TerminalFrame = Readonly<{
  schema: typeof FRAME_SCHEMA;
  fixture: string;
  checkpoint: string;
  viewport: Readonly<{ width: number; height: number }>;
  semanticText: readonly string[];
  cells: readonly FrameCell[];
  renderer: RendererProvenance;
  fixtureSha256: string;
}>;

export type FrameIndexEntry = Readonly<{
  id: string;
  fixture: string;
  path: string;
  sha256: string;
  fixtureSha256: string;
  checkpoint: string;
  viewport: Readonly<{ width: number; height: number }>;
}>;

export type TerminalFrameIndex = Readonly<{
  schema: typeof FRAME_INDEX_SCHEMA;
  generator: "burnlist-b6-offscreen@1";
  provenance: RendererProvenance;
  entries: readonly FrameIndexEntry[];
}>;
