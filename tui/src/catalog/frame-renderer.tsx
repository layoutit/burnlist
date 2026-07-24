#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestRenderer, ManualClock } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act } from "react";
import { FIXTURE_ID, FixtureFlame } from "./fixture-flame";
import { glyphFixture } from "./glyph-fixture";
import { listFixture, listFixtureStates, listPreviewRows } from "./list-fixture";
import { statusFixtureStates } from "./status-fixture";
import { visualParityFixture } from "./visual-parity-fixture";
import { controlsCheckpoint, controlsFixture } from "../oven-runtime/controls/controls-fixture";
import { ControlsSurface } from "../oven-runtime/controls/controls-surface";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
import { StructuralOvenViewport } from "../oven-runtime/layout/structural-viewport";
import { TerminalList } from "../oven-runtime/components/list-components";
import { TerminalOvenViewport } from "../oven-runtime/components/terminal-oven-viewport";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "../oven-runtime/components/terminal-capabilities";
import { admitTerminalOven, type JsonValue } from "../oven-runtime/terminal-contract";
import { initTerminalRuntime, reduceTerminalRuntime } from "../oven-runtime/state-runtime";
import { layoutTerminalNodes } from "../oven-runtime/layout/layout-runtime";
import { FRAME_INDEX_SCHEMA, FRAME_SCHEMA, type RendererProvenance, type TerminalFrame, type TerminalFrameIndex } from "./frame-contract";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = resolve(root, "dashboard/src/generated/terminal-frames");
const indexPath = join(generated, "index.json");
const evidencePath = resolve(root, "tui/src/oven-runtime/terminal-evidence-index.json");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const frameName = (frame: TerminalFrame, text: string) => `${frame.fixture}.${frame.viewport.width}x${frame.viewport.height}.${frame.checkpoint}.${sha(text).slice(0, 16)}.json`;
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
function capture(setup: Awaited<ReturnType<typeof createTestRenderer>>, recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } }, fixture: string, checkpoint: string, fixtureSha256: string, provenance: TerminalFrame["renderer"]): TerminalFrame {
  const buffer = setup.renderer.currentRenderBuffer;
  const text = recorded.frame.split("\n").map((line) => line.trimEnd());
  return { schema: FRAME_SCHEMA, fixture, checkpoint, viewport: { width: buffer.width, height: buffer.height }, semanticText: text, cells: cellsFromFrame(recorded.frame, buffer.width, buffer.height, recorded.buffers || {}), renderer: provenance, fixtureSha256 };
}
async function render(width: number, checkpoint: string, reducedMotion: boolean, key: string | null, provenance: TerminalFrame["renderer"], fixtureSha256: string, advance: number): Promise<TerminalFrame> {
  const clock = new ManualClock(), setup = await createTestRenderer({ width, height: 12, clock, targetFps: 60, useThread: false });
  const rootNode = createRoot(setup.renderer); let recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } } | undefined;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot);
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { flushSync(() => rootNode.render(<FixtureFlame reducedMotion={reducedMotion} clock={clock} />)); });
    await setup.renderOnce();
    if (key === "right") { await act(async () => { setup.mockInput.pressArrow("right"); await Promise.resolve(); }); await setup.renderOnce(); }
    if (!reducedMotion && advance) { await act(async () => { clock.advance(advance); }); await setup.renderOnce(); }
    if (!recorded) throw new Error("terminal story frames: OpenTUI produced no raw frame"); return capture(setup, recorded, FIXTURE_ID, checkpoint, fixtureSha256, provenance);
  } finally { setup.renderer.off("frame", snapshot); await act(async () => { rootNode.unmount(); }); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; }
}
async function renderStructural(width: number, height: number, checkpoint: string, focusedPath: string, provenance: TerminalFrame["renderer"], fixtureSha256: string): Promise<TerminalFrame> {
  const fixture = await readFile(resolve(root, "tui/src/catalog/structural-fixture.oven"), "utf8"), compiled = compileOven(fixture, { file: "tui/src/catalog/structural-fixture.oven" });
  if (!compiled.ok) fail(`structural fixture does not compile: ${compiled.diagnostics[0]?.message || "unknown error"}`);
  const setup = await createTestRenderer({ width, height, clock: new ManualClock(), targetFps: 60, useThread: false }), rootNode = createRoot(setup.renderer);
  let recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } } | undefined;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot);
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { flushSync(() => rootNode.render(<StructuralOvenViewport nodes={compiled.ir.root} viewport={{ width, height }} focusedPath={focusedPath} />)); });
    await setup.renderOnce();
    if (!recorded) throw new Error("terminal story frames: OpenTUI produced no structural frame");
    const frame = capture(setup, recorded, "structural-layout", checkpoint, fixtureSha256, provenance), layout = layoutTerminalNodes(compiled.ir.root, { width, height }, focusedPath);
    const painted = layout.cells.filter((cell) => (cell.kind === "text" || cell.kind === "icon") && cell.text);
    for (const [index, left] of painted.entries()) for (const right of painted.slice(index + 1)) if (left.rect.y < right.rect.y + right.rect.height && right.rect.y < left.rect.y + left.rect.height && left.rect.x < right.rect.x + right.rect.width && right.rect.x < left.rect.x + left.rect.width) fail("structural text cells overlap");
    if (width === 40 && (!painted.some((cell) => cell.collapsed) || !frame.semanticText.some((line) => line.includes("↳")))) fail("narrow structural frame did not render its collapse marker");
    if (width === 140 && checkpoint === "final-focus") {
      const rendered = frame.semanticText.join("\n"), values = ["This text stays above the footer", "Narrow terminals reflow this", "Overflow row 09", "Clock3"];
      if (values.some((value) => !rendered.includes(value)) || /This─text|Overflow─row|Clock3─/u.test(rendered)) fail("structural leaf paint contains transformed spaces or border glyphs");
    }
    return frame;
  } finally { setup.renderer.off("frame", snapshot); await act(async () => { rootNode.unmount(); }); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previous; }
}
async function renderList(width: number, checkpoint: typeof listFixtureStates[number], provenance: TerminalFrame["renderer"], fixtureSha256: string): Promise<TerminalFrame> {
  const height = 14, setup = await createTestRenderer({ width, height, clock: new ManualClock(), targetFps: 60, useThread: false }), rootNode = createRoot(setup.renderer);
  let recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } } | undefined;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot);
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const preview = listPreviewRows(width, checkpoint);
    await act(async () => { flushSync(() => rootNode.render(<box width={width} height={height} flexDirection="column"><TerminalList model={{ ...preview, columns: listFixture.columns, height: height - 2 }} /><box height={2} border={["top"]}><text>q:back · esc:exit</text></box></box>)); });
    await setup.renderOnce();
    const snapshotData = recorded;
    if (!snapshotData) throw new Error("terminal story frames: shared list frame produced no raw frame");
    const frame = capture(setup, snapshotData, listFixture.id, checkpoint, fixtureSha256, provenance), text = frame.semanticText.join("\n");
    if (!text.includes("STATE") || !text.includes(checkpoint === "latest" ? "B28" : "B5") || !text.includes("q:back")) fail("shared list frame omitted required list or footer content");
    if (checkpoint === "latest" && frame.semanticText.slice(-2).join("\n").includes("B28")) fail("shared list final row overlaps the footer");
    return frame;
  } finally { setup.renderer.off("frame", snapshot); await act(async () => { rootNode.unmount(); }); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previous; }
}
async function renderControls(width: number, checkpoint: typeof controlsFixture.checkpoints[number], provenance: TerminalFrame["renderer"], fixtureSha256: string): Promise<TerminalFrame> {
  const height = 12, setup = await createTestRenderer({ width, height, clock: new ManualClock(), targetFps: 60, useThread: false }), rootNode = createRoot(setup.renderer); let recorded: any;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot); const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try { await act(async () => { flushSync(() => rootNode.render(<ControlsSurface state={controlsCheckpoint(checkpoint)} />)); }); await setup.renderOnce(); if (!recorded) fail("controls frame missing"); const frame = capture(setup, recorded, controlsFixture.id, checkpoint, fixtureSha256, provenance); if (!frame.semanticText.slice(-2).join("\n").includes("q:back")) fail("controls frame footer collision"); return frame; }
  finally { setup.renderer.off("frame", snapshot); await act(async () => { rootNode.unmount(); }); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previous; }
}
async function renderStatus(width: number, checkpoint: string, payload: JsonValue, provenance: TerminalFrame["renderer"], fixtureSha256: string): Promise<TerminalFrame> {
  const fixture = checkpoint === "empty" ? "status-empty-fixture.oven" : "status-fixture.oven";
  const height = 12, source = await readFile(resolve(root, `tui/src/catalog/${fixture}`), "utf8"), compiled = compileOven(source, { file: `tui/src/catalog/${fixture}` });
  if (!compiled.ok) fail(`status fixture does not compile: ${compiled.diagnostics[0]?.message || "unknown error"}`);
  const result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  if (result.status !== "ready") fail(`status fixture admission failed: ${result.diagnostics[0]?.message || "unknown error"}`);
  const setup = await createTestRenderer({ width, height, clock: new ManualClock(), targetFps: 60, useThread: false }), rootNode = createRoot(setup.renderer); let recorded: any;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot); const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try { await act(async () => { flushSync(() => rootNode.render(<TerminalOvenViewport result={result} />)); }); await setup.renderOnce(); if (!recorded) fail("status frame missing"); const frame = capture(setup, recorded, "heading-status", checkpoint, fixtureSha256, provenance); if (!frame.semanticText.join("\n").includes("q:back")) fail("status frame footer collision"); return frame; }
  finally { setup.renderer.off("frame", snapshot); await act(async () => { rootNode.unmount(); }); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previous; }
}
async function renderVisualParity(width: number, checkpoint: "desktop" | "mobile", provenance: TerminalFrame["renderer"], fixtureSha256: string): Promise<TerminalFrame> {
  const height = 24, source = await readFile(resolve(root, "ovens/visual-parity/visual-parity.oven"), "utf8"), compiled = compileOven(source, { file: "ovens/visual-parity/visual-parity.oven" });
  if (!compiled.ok) fail(`Visual Parity fixture does not compile: ${compiled.diagnostics[0]?.message || "unknown error"}`);
  const initial = initTerminalRuntime(compiled.ir, visualParityFixture.payload), state = checkpoint === "desktop" ? initial : reduceTerminalRuntime(initial, { type: "domainSelected", id: "domain-select", value: checkpoint }, compiled.ir);
  const result = admitTerminalOven(compiled.ir, { status: "ready", payload: visualParityFixture.payload }, { viewport: { width, height }, controls: state.controls }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  if (result.status !== "ready") fail(`Visual Parity admission failed: ${result.diagnostics[0]?.message || "unknown error"}`);
  const setup = await createTestRenderer({ width, height, clock: new ManualClock(), targetFps: 60, useThread: false }), rootNode = createRoot(setup.renderer); let recorded: any;
  const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot); try { flushSync(() => rootNode.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce(); if (!recorded) fail("Visual Parity frame missing"); const frame = capture(setup, recorded, visualParityFixture.id, checkpoint, fixtureSha256, provenance), text = frame.semanticText.join("\n"); if (["Current", "Reference", "Difference", checkpoint === "desktop" ? "Frame 7" : "Frame 8", "q:back"].some((label) => !text.includes(label)) || text.includes("esc:exit")) fail("Visual Parity frame omitted or contradicted media semantics"); return frame; } finally { setup.renderer.off("frame", snapshot); rootNode.unmount(); setup.renderer.destroy(); }
}
export async function buildFrames(): Promise<Record<string, string>> {
  const shared = ["tui/package-lock.json", "tui/package.json", "tui/src/catalog/frame-renderer.tsx"], flameInputs = ["tui/src/catalog/glyph-fixture.ts", "tui/src/catalog/fixture-flame.tsx", "tui/src/glyph-surface.ts", "tui/src/fire-frame.ts"], structuralInputs = ["tui/src/catalog/structural-fixture.oven", "tui/src/oven-runtime/layout/layout-runtime.ts", "tui/src/oven-runtime/layout/structural-viewport.tsx"], listInputs = ["tui/src/catalog/list-fixture.ts", "tui/src/oven-runtime/components/list-components.tsx", "tui/src/theme.ts"], statusInputs = ["tui/src/catalog/status-fixture.ts", "tui/src/catalog/status-fixture.oven", "tui/src/catalog/status-empty-fixture.oven", "tui/src/oven-runtime/components/status-components.tsx", "tui/src/oven-runtime/components/terminal-oven-viewport.tsx", "tui/src/oven-runtime/terminal-contract.ts"], controlsInputs = ["tui/src/oven-runtime/controls/controls-fixture.ts", "tui/src/oven-runtime/controls/controls-surface.tsx"];
  const sourceHash = async (inputs: readonly string[]) => sha((await Promise.all([...shared, ...inputs].map(async (path) => `${path}\n${await readFile(resolve(root, path), "utf8")}`))).join("\n"));
  const visualInputs = ["tui/src/catalog/visual-parity-fixture.ts", "ovens/visual-parity/visual-parity.oven", "tui/src/oven-runtime/components/media-components.tsx", "tui/src/glyph-image.tsx", "tui/src/image-supersample.ts", "tui/src/png-glyph.ts", "tui/src/oven-runtime/components/terminal-oven-viewport.tsx", "tui/src/oven-runtime/state-runtime.ts"], flameSha256 = await sourceHash(flameInputs), structuralSha256 = await sourceHash(structuralInputs), listSha256 = await sourceHash(listInputs), statusSha256 = await sourceHash(statusInputs), controlsSha256 = await sourceHash(controlsInputs), visualSha256 = await sourceHash(visualInputs);
  const lock = JSON.parse(await readFile(resolve(root, "tui/package-lock.json"), "utf8"));
  const packageRecord = (name: string) => { const entry = lock.packages[`node_modules/${name}`]; if (!entry?.version || !entry?.integrity) fail(`lockfile is missing pinned ${name} provenance`); return { version: String(entry.version), integrity: String(entry.integrity) }; };
  const bunPackage = packageRecord("bun");
  if (Bun.version !== bunPackage.version) fail(`Bun runtime ${Bun.version} does not match pinned ${bunPackage.version}`);
  const packageNames = ["@opentui/core", "@opentui/react", "glyphcss", "@glyphcss/core", "@glyphcss/effects"] as const;
  const provenance = (sourceSha256: string): RendererProvenance => ({ sourceSha256, bun: { runtimeVersion: Bun.version, packageVersion: bunPackage.version, integrity: bunPackage.integrity }, packages: Object.fromEntries(packageNames.map((name) => [name, packageRecord(name)])) });
  const frames = [];
  for (const state of glyphFixture.states) for (const width of state.viewports) frames.push(await render(width, state.checkpoint, state.reducedMotion, state.key, provenance(flameSha256), flameSha256, state.advanceMs));
  for (const width of [40, 60, 80, 100, 140]) for (const [height, checkpoint, focusedPath] of [[10, "short", "root/0/1/0"], [20, "tall", "root/0/1/1"], [20, "final-focus", "root/0/1/11"]] as const) frames.push(await renderStructural(width, height, checkpoint, focusedPath, provenance(structuralSha256), structuralSha256));
  for (const width of [36, 48, 72]) for (const checkpoint of listFixtureStates) frames.push(await renderList(width, checkpoint, provenance(listSha256), listSha256));
  for (const width of [36, 72]) for (const checkpoint of controlsFixture.checkpoints) frames.push(await renderControls(width, checkpoint, provenance(controlsSha256), controlsSha256));
  for (const width of [36, 72]) for (const [checkpoint, state] of Object.entries(statusFixtureStates)) frames.push(await renderStatus(width, checkpoint, state.payload, provenance(statusSha256), statusSha256));
  for (const width of [42, 90]) for (const checkpoint of visualParityFixture.checkpoints) frames.push(await renderVisualParity(width, checkpoint, provenance(visualSha256), visualSha256));
  return Object.fromEntries(frames.map((frame) => { const text = stable(frame); return [frameName(frame, text), text]; }));
}
async function desired() {
  const files = await buildFrames();
  const entries = Object.entries(files).map(([name, text]) => {
    const frame = JSON.parse(text) as TerminalFrame;
    return { id: `${frame.fixture}:${frame.viewport.width}x${frame.viewport.height}:${frame.checkpoint}`, fixture: frame.fixture, path: name, sha256: sha(text), fixtureSha256: frame.fixtureSha256, checkpoint: frame.checkpoint, viewport: frame.viewport };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const index: TerminalFrameIndex = { schema: FRAME_INDEX_SCHEMA, generator: "burnlist-b6-offscreen@1", provenance: JSON.parse(Object.values(files)[0]!).renderer, entries };
  const structuralSources = Object.fromEntries(await Promise.all(["tui/src/oven-runtime/layout/layout-runtime.ts", "tui/src/oven-runtime/layout/structural-viewport.tsx", "tui/src/catalog/structural-fixture.oven", "tui/src/catalog/frame-renderer.tsx", "tui/package.json", "tui/package-lock.json"].map(async (path) => [path, sha(await readFile(resolve(root, path), "utf8"))])));
  const fixtureSource = await readFile(resolve(root, "tui/src/catalog/structural-fixture.oven"), "utf8"), fixtureIR = compileOven(fixtureSource, { file: "tui/src/catalog/structural-fixture.oven" });
  if (!fixtureIR.ok) fail("structural fixture does not compile for evidence");
  const structuralKinds = new Set<string>(); const visit = (node: { kind: string; children: readonly any[] }) => { if (["box", "grid", "stack", "panel", "text", "icon"].includes(node.kind)) structuralKinds.add(node.kind); node.children.forEach(visit); }; fixtureIR.ir.root.forEach(visit);
  const expectedStructuralKinds = ["box", "grid", "stack", "panel", "text", "icon"].sort();
  if (JSON.stringify([...structuralKinds].sort()) !== JSON.stringify(expectedStructuralKinds)) fail("structural fixture must compile exactly the six structural kinds");
  const structuralAtoms = [...structuralKinds].sort().flatMap((kind) => [`grammar:element:${kind}`, `compiled:element:${kind}`]);
  const baseRecords = entries.filter((entry) => entry.fixture !== "structural-layout" && entry.fixture !== listFixture.id && entry.fixture !== "heading-status").map((entry) => ({ recordId: entry.id, fixture: entry.fixture, frameId: entry.id, artifactPath: `dashboard/src/generated/terminal-frames/${entry.path}`, artifactSha256: entry.sha256, sourceSha256: entry.fixtureSha256, viewport: entry.viewport, checkpoint: entry.checkpoint }));
  const listSources = Object.fromEntries(await Promise.all(["tui/src/catalog/list-fixture.ts", "tui/src/oven-runtime/components/list-components.tsx", "tui/src/theme.ts", "tui/src/catalog/frame-renderer.tsx", "tui/package.json", "tui/package-lock.json"].map(async (path) => [path, sha(await readFile(resolve(root, path), "utf8"))])));
  const listRecords = entries.filter((entry) => entry.fixture === listFixture.id).map((entry) => ({ recordId: entry.id, fixture: entry.fixture, frameId: entry.id, artifactPath: `dashboard/src/generated/terminal-frames/${entry.path}`, artifactSha256: entry.sha256, sourceSha256: entry.fixtureSha256, viewport: entry.viewport, checkpoint: entry.checkpoint, implementationExport: "tui/src/oven-runtime/components/list-components.tsx#TerminalList", sourceFiles: listSources }));
  const structuralFrames = [40, 60, 80, 100, 140].flatMap((width) => [[width, 10, "short"], [width, 20, "tall"], [width, 20, "final-focus"]].map(([w, h, checkpoint]) => `structural-layout:${w}x${h}:${checkpoint}`));
  if (structuralFrames.some((id) => !entries.some((entry) => entry.id === id))) throw new Error("terminal story frames: structural matrix is incomplete");
  const structuralRows = structuralFrames.map((id) => entries.find((entry) => entry.id === id)!);
  const semantic = new Set(structuralRows.map((entry) => JSON.stringify(JSON.parse(files[entry.path]!).semanticText)));
  if (semantic.size !== structuralRows.length) throw new Error("terminal story frames: duplicate structural frame content");
  const structuralRecords = structuralRows.map((frame, index) => {
    const atomId = structuralAtoms[index];
    return { recordId: atomId ? `structural-layout:${atomId}` : `structural-layout:support:${frame.id}`, target: atomId ? `atom:${atomId}` : `support:frame:${frame.id}`, fixture: "structural-layout", frameId: frame.id, artifactPath: `dashboard/src/generated/terminal-frames/${frame.path}`, artifactSha256: frame.sha256, implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport", sourceFiles: structuralSources };
  });
  const statusRecords = entries.filter((entry) => entry.fixture === "heading-status").map((entry) => ({ recordId: entry.id, fixture: entry.fixture, frameId: entry.id, artifactPath: `dashboard/src/generated/terminal-frames/${entry.path}`, artifactSha256: entry.sha256, implementationExport: "tui/src/oven-runtime/components/status-components.tsx#TerminalStatusSurface" }));
  const evidence = { schema: "burnlist-terminal-evidence-index@1", generator: "burnlist-b6-offscreen@1", records: [...baseRecords, ...structuralRecords, ...listRecords, ...statusRecords] };
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
