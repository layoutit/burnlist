#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestRenderer, ManualClock } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act } from "react";
import { FIXTURE_ID, FixtureFlame, fixtureSource } from "./fixture-flame";
import { FRAME_INDEX_SCHEMA, FRAME_SCHEMA, type RendererProvenance, type TerminalFrame, type TerminalFrameIndex } from "./frame-contract";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = resolve(root, "dashboard/src/generated/terminal-frames");
const indexPath = join(generated, "index.json");
const evidencePath = resolve(root, "tui/src/oven-runtime/terminal-evidence-index.json");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const frameName = (frame: TerminalFrame, text: string) => `${FIXTURE_ID}.${frame.viewport.width}x${frame.viewport.height}.${frame.checkpoint}.${sha(text).slice(0, 16)}.json`;
const fail = (message: string) => { throw new Error(`terminal story frames: ${message}`); };

async function withLock<T>(work: () => Promise<T>) {
  const lock = `${generated}.lock`;
  await mkdir(dirname(generated), { recursive: true });
  try { await writeFile(lock, String(process.pid), { flag: "wx" }); } catch { fail("generator lock is already held"); }
  try { return await work(); } finally { await rm(lock, { force: true }); }
}
async function atomic(path: string, text: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, text); await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
}
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export function cellsFromFrame(frame: string, widthColumns: number, height: number, buffers: { char?: Uint32Array; fg?: Uint16Array; bg?: Uint16Array; attributes?: Uint32Array }) {
  const cells = [] as Array<{ char: string; fg: number; bg: number; attributes: number; continuation: boolean }>;
  if (!buffers.char || !buffers.fg || !buffers.bg || !buffers.attributes) fail("OpenTUI raw recorder omitted framebuffer buffers");
  const { char, fg, bg, attributes } = buffers as { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array };
  const colorStride = fg.length / (widthColumns * height);
  if (!Number.isInteger(colorStride) || bg.length !== fg.length || attributes.length !== widthColumns * height) fail("OpenTUI recorder buffer dimensions disagree with viewport");
  const packed = (input: Uint16Array, offset: number) => Array.from(input.slice(offset * colorStride, (offset + 1) * colorStride)).reduce((value, part, index) => value | ((part & 255) << (index * 8)), 0) >>> 0;
  if (char.length !== widthColumns * height) fail("OpenTUI raw character dimensions disagree with viewport");
  const lines = frame.split("\n");
  for (let row = 0; row < height; row += 1) { const glyphs = Array.from(segmenter.segment(lines[row] || ""), (part) => part.segment); let glyph = 0; for (let column = 0; column < widthColumns; column += 1) { const offset = row * widthColumns + column, rawChar = char[offset]!; const continuation = ((rawChar & 0xc0000000) >>> 0) === 0xc0000000; const visible = continuation ? "" : glyphs[glyph++] || " "; cells.push({ char: visible, fg: packed(fg, offset), bg: packed(bg, offset), attributes: attributes[offset]!, continuation }); } }
  return cells;
}
function capture(setup: Awaited<ReturnType<typeof createTestRenderer>>, recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } }, checkpoint: string, fixtureSha256: string, provenance: TerminalFrame["renderer"]): TerminalFrame {
  const buffer = setup.renderer.currentRenderBuffer;
  const text = recorded.frame.split("\n").map((line) => line.trimEnd());
  return { schema: FRAME_SCHEMA, fixture: FIXTURE_ID, checkpoint, viewport: { width: buffer.width, height: buffer.height }, semanticText: text, cells: cellsFromFrame(recorded.frame, buffer.width, buffer.height, recorded.buffers || {}), renderer: provenance, fixtureSha256 };
}
async function render(width: number, checkpoint: string, reducedMotion: boolean, key = false, provenance: TerminalFrame["renderer"], fixtureSha256 = sha(fixtureSource), advance = 240): Promise<TerminalFrame> {
  const clock = new ManualClock(), setup = await createTestRenderer({ width, height: 12, clock, targetFps: 60, useThread: false });
  const rootNode = createRoot(setup.renderer); let recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } } | undefined;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot);
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { flushSync(() => rootNode.render(<FixtureFlame reducedMotion={reducedMotion} clock={clock} />)); });
    await setup.renderOnce();
    if (key) { await act(async () => { setup.mockInput.pressArrow("right"); await Promise.resolve(); }); await setup.renderOnce(); }
    if (!reducedMotion && advance) { await act(async () => { clock.advance(advance); }); await setup.renderOnce(); }
    if (!recorded) throw new Error("terminal story frames: OpenTUI produced no raw frame"); return capture(setup, recorded, checkpoint, fixtureSha256, provenance);
  } finally { setup.renderer.off("frame", snapshot); await act(async () => { rootNode.unmount(); }); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; }
}
export async function buildFrames(): Promise<Record<string, string>> {
  const inputs = ["tui/package-lock.json", "tui/package.json", "tui/src/catalog/fixture-flame.tsx", "tui/src/catalog/frame-renderer.tsx", "tui/src/glyph-surface.ts", "tui/src/fire-frame.ts"];
  const source = await Promise.all(inputs.map(async (path) => `${path}\n${await readFile(resolve(root, path), "utf8")}`));
  const sourceSha256 = sha(source.join("\n"));
  const lock = JSON.parse(await readFile(resolve(root, "tui/package-lock.json"), "utf8"));
  const packageRecord = (name: string) => { const entry = lock.packages[`node_modules/${name}`]; if (!entry?.version || !entry?.integrity) fail(`lockfile is missing pinned ${name} provenance`); return { version: String(entry.version), integrity: String(entry.integrity) }; };
  const bunPackage = packageRecord("bun");
  if (Bun.version !== bunPackage.version) fail(`Bun runtime ${Bun.version} does not match pinned ${bunPackage.version}`);
  const packageNames = ["@opentui/core", "@opentui/react", "glyphcss", "@glyphcss/core", "@glyphcss/effects"] as const;
  const provenance: RendererProvenance = { sourceSha256, bun: { runtimeVersion: Bun.version, packageVersion: bunPackage.version, integrity: bunPackage.integrity }, packages: Object.fromEntries(packageNames.map((name) => [name, packageRecord(name)])) };
  const frames = [
    await render(42, "t0", false, false, provenance, sourceSha256, 0), await render(42, "t240", false, false, provenance, sourceSha256, 240), await render(42, "keyboard-right", false, true, provenance, sourceSha256), await render(42, "reduced-t0", true, false, provenance, sourceSha256, 0), await render(42, "reduced-t240", true, false, provenance, sourceSha256, 240), await render(64, "t0", false, false, provenance, sourceSha256, 0),
  ];
  return Object.fromEntries(frames.map((frame) => { const text = stable(frame); return [frameName(frame, text), text]; }));
}
async function desired() {
  const files = await buildFrames();
  const entries = Object.entries(files).map(([name, text]) => {
    const frame = JSON.parse(text) as TerminalFrame;
    return { id: `${FIXTURE_ID}:${frame.viewport.width}x${frame.viewport.height}:${frame.checkpoint}`, path: name, sha256: sha(text), fixtureSha256: frame.fixtureSha256, checkpoint: frame.checkpoint, viewport: frame.viewport };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const index: TerminalFrameIndex = { schema: FRAME_INDEX_SCHEMA, generator: "burnlist-b6-offscreen@1", provenance: JSON.parse(Object.values(files)[0]!).renderer, entries };
  const evidence = { schema: "burnlist-terminal-evidence-index@1", generator: "burnlist-b6-offscreen@1", records: entries.map((entry) => ({ recordId: entry.id, artifactPath: `dashboard/src/generated/terminal-frames/${entry.path}`, artifactSha256: entry.sha256, sourceSha256: entry.fixtureSha256, viewport: entry.viewport, checkpoint: entry.checkpoint })) };
  return { files, index: stable(index), evidence: stable(evidence) };
}
async function existingFiles() { try { return (await Bun.$`git -C ${root} ls-files --others --exclude-standard -- dashboard/src/generated/terminal-frames`.text()).trim().split("\n").filter(Boolean); } catch { return []; } }
async function check() {
  const want = await desired(), names = new Set([...Object.keys(want.files), "index.json"]);
  let actual: string[]; try { actual = (await readdir(generated)).filter((name) => name.endsWith(".json")); } catch { actual = []; }
  if (!actual.length) fail("missing generated index; run generate:terminal-story-frames");
  if (actual.length !== names.size || actual.some((name) => !names.has(name))) fail("generated outputs are missing or extra");
  for (const [name, text] of Object.entries(want.files)) if (await Bun.file(join(generated, name)).text() !== text) fail(`stale frame ${name}`);
  if (await Bun.file(indexPath).text() !== want.index) fail("stale index");
  if (await Bun.file(evidencePath).text() !== want.evidence) fail("stale B1 evidence index");
  const untracked = await existingFiles(); if (untracked.length) fail(`untracked generated output ${untracked.join(", ")}`);
}
async function write() { const want = await desired(); await mkdir(generated, { recursive: true }); const names = new Set([...Object.keys(want.files), "index.json"]), old = (await readdir(generated)).filter((name) => name.endsWith(".json") && !names.has(name)); for (const [name, text] of Object.entries(want.files)) await atomic(join(generated, name), text); await atomic(indexPath, want.index); await atomic(evidencePath, want.evidence); for (const name of old) await rm(join(generated, name)); }
async function main() { const mode = process.argv[2]; if (mode !== "--write" && mode !== "--check") fail("usage: --write or --check"); await withLock(async () => mode === "--write" ? write() : check()); }
if (import.meta.main) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
