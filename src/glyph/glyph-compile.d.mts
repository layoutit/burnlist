export interface GlyphNode {
  kind: string;
  attributes: Record<string, string | number>;
  children: GlyphNode[];
  source: { offset: number; line: number; column: number };
}

export interface GlyphScreen {
  schema: "burnlist-glyph-screen@1";
  id: string;
  title: string;
  version: 1;
  root: GlyphNode;
}

export interface GlyphDiagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  path: string;
}

export function compileGlyph(source: string, options?: { file?: string }):
  | { ok: true; ir: GlyphScreen }
  | { ok: false; diagnostics: GlyphDiagnostic[] };
