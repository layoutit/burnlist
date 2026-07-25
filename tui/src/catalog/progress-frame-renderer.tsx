#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestRenderer, ManualClock } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act } from "react";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
import { admitTerminalOven, type JsonValue, type TerminalNode } from "../oven-runtime/terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "../oven-runtime/components/terminal-capabilities";
import { TerminalOvenViewport } from "../oven-runtime/components/terminal-oven-viewport";
import { FRAME_SCHEMA, type RendererProvenance, type TerminalFrame } from "./frame-contract";
import { cellsFromFrame } from "./frame-renderer";
import { orderedSemanticText } from "../terminal-accessibility";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = resolve(root, "dashboard/src/generated/terminal-progress-frames");
const indexPath = join(generated, "index.json");
const evidencePath = resolve(root, "tui/src/oven-runtime/terminal-progress-evidence-index.json");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const stable = (value: unknown) => `${JSON.stringify(value)}\n`;
const fail = (message: string): never => { throw new Error(`terminal progress frames: ${message}`); };
const targetKinds = ["kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "progress-value"] as const;
type TargetKind = typeof targetKinds[number];
const targetFile = (kind: TargetKind) => `tui/src/catalog/progress-target-${kind}.oven`;
const inputs = ["tui/package-lock.json", "tui/package.json", "tui/src/catalog/progress-frame-renderer.tsx", "tui/src/catalog/frame-renderer.tsx", "src/ovens/oven-progress-metrics.mjs", "tui/src/catalog/progress-fixture.oven", ...targetKinds.map(targetFile), "tui/src/glyph-surface.ts", "tui/src/oven-runtime/components/component-layout.ts", "tui/src/oven-runtime/components/progress-components.tsx", "tui/src/oven-runtime/components/progress-glyph.ts", "tui/src/oven-runtime/components/terminal-capabilities.ts", "tui/src/oven-runtime/components/terminal-oven-viewport.tsx", "tui/src/oven-runtime/layout/layout-runtime.ts", "tui/src/oven-runtime/terminal-contract.ts", "tui/src/oven-runtime/value-runtime.ts"];
const states = {
  empty: { percent: 0, done: 0, total: 0, burns: [], metric: { total: 0 }, required: "empty" },
  partial: { percent: 57, done: 4, total: 7, burns: [{ result: "pass" }, { result: "worsened" }, { result: "blocked" }], metric: { total: 7, failed: 1, blocked: 1 }, required: "active" },
  complete: { percent: 100, done: 7, total: 7, burns: [{ result: "pass" }, { result: "pass" }], metric: { total: 7, failed: 0, blocked: 0 }, required: "done" },
  overflow: { percent: 180, done: 12, total: 7, burns: [{ result: "pass" }, { result: "worsened" }, { result: "blocked" }, { result: "other" }], metric: { total: 4, failed: 9, blocked: 5 }, required: "clamped" },
  "required-error": {},
} as const satisfies Record<string, JsonValue>;
const targetPayloads: Record<TargetKind, JsonValue> = {
  "kpi-strip": {}, "kpi-item": {}, "progress-donut": { progress: 37 },
  "burn-donut": { burns: [...Array.from({ length: 100 }, () => ({ result: "pass" })), { result: "worsened" }, { result: "blocked" }, { result: "other" }] },
  "waffle-metric": { metric: { total: 11, failed: 3, blocked: 2 } },
  "progress-value": { done: 13, total: 29, percent: 45 },
};
const implementations: Record<TargetKind, string> = {
  "kpi-strip": "tui/src/oven-runtime/components/progress-components.tsx#TerminalKpiStrip",
  "kpi-item": "tui/src/oven-runtime/components/progress-components.tsx#TerminalKpiItem",
  "progress-donut": "tui/src/oven-runtime/components/progress-glyph.ts#progressGlyphFrame",
  "burn-donut": "tui/src/oven-runtime/components/progress-glyph.ts#progressGlyphFrame",
  "waffle-metric": "tui/src/oven-runtime/components/progress-glyph.ts#progressGlyphFrame",
  "progress-value": "tui/src/oven-runtime/components/progress-components.tsx#checklistProgressValue",
};
const publicKinds: Record<string, TargetKind> = {
  "public:dashboard/src/oven/index.ts#BurnDonut": "burn-donut", "public:dashboard/src/oven/index.ts#ProgressDonut": "progress-donut",
  "public:dashboard/src/oven/index.ts#WaffleMetric": "waffle-metric", "public:dashboard/src/oven/index.ts#KpiItem": "kpi-item",
  "public:dashboard/src/oven/index.ts#KpiStrip": "kpi-strip",
};
const atomsFor = (kind: TargetKind) => [`grammar:element:${kind}`, `compiled:element:${kind}`];
const atomKinds = new Map<string, TargetKind>([...targetKinds.flatMap((kind) => atomsFor(kind).map((atom) => [atom, kind] as const)), ...Object.entries(publicKinds)]);
async function atomic(path: string, text: string) { const temp = `${path}.${process.pid}.tmp`; try { await writeFile(temp, text); await rename(temp, path); } finally { await rm(temp, { force: true }); } }
async function sourceData() {
  const rows = await Promise.all(inputs.map(async (path) => [path, await readFile(resolve(root, path), "utf8")] as const));
  return { digest: sha(rows.map(([path, text]) => `${path}\n${text}`).join("\n")), files: Object.fromEntries(rows.map(([path, text]) => [path, sha(text)])) };
}
async function provenance(sourceSha256: string): Promise<RendererProvenance> {
  const lock = JSON.parse(await readFile(resolve(root, "tui/package-lock.json"), "utf8"));
  const packageRecord = (name: string) => { const row = lock.packages[`node_modules/${name}`]; if (!row?.version || !row?.integrity) fail(`missing pinned ${name}`); return { version: String(row.version), integrity: String(row.integrity) }; };
  const bun = packageRecord("bun");
  if (Bun.version !== bun.version) fail("Bun runtime does not match lockfile");
  return { sourceSha256, bun: { runtimeVersion: Bun.version, packageVersion: bun.version, integrity: bun.integrity }, packages: Object.fromEntries(["@opentui/core", "@opentui/react", "glyphcss", "@glyphcss/core", "@glyphcss/effects"].map((name) => [name, packageRecord(name)])) };
}
function locate(nodes: readonly TerminalNode[], kind: TargetKind) {
  const found: Array<{ node: TerminalNode; path: string }> = [];
  const visit = (node: TerminalNode, path: string) => { if (node.kind === kind) found.push({ node, path }); node.children.forEach((child, index) => visit(child, `${path}.children.${index}`)); };
  nodes.forEach((node, index) => visit(node, `root.${index}`));
  if (found.length !== 1) fail(`${kind} fixture must contain exactly one target node`);
  return found[0]!;
}
async function render(width: number, checkpoint: string, payload: JsonValue, sourceSha256: string, renderer: RendererProvenance, fixturePath = "tui/src/catalog/progress-fixture.oven", targetKind?: TargetKind) {
  const fixtureSource = await readFile(resolve(root, fixturePath), "utf8"), compiled = compileOven(fixtureSource, { file: fixturePath });
  if (!compiled.ok) fail(`fixture compile failed: ${compiled.diagnostics[0]?.message}`);
  const height = 20, result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  if (result.status !== "ready") fail(`fixture admission failed: ${result.diagnostics[0]?.message}`);
  const setup = await createTestRenderer({ width, height, clock: new ManualClock(), useThread: false }), app = createRoot(setup.renderer);
  let recorded: any; const snapshot = () => { const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers; recorded = { frame: new TextDecoder().decode(buffer.getRealCharBytes(true)), buffers: { char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg), bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes) } }; };
  setup.renderer.on("frame", snapshot); const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = reactGlobal.IS_REACT_ACT_ENVIRONMENT; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { flushSync(() => app.render(<TerminalOvenViewport result={result} />)); }); await setup.renderOnce();
    if (!recorded) fail("OpenTUI produced no frame");
    const semanticText = orderedSemanticText(recorded.frame), cells = cellsFromFrame(recorded.frame, width, height, recorded.buffers), text = semanticText.join("\n");
    if (checkpoint === "required-error") { if (!text.includes("Missing required")) fail("required binding fallback missing"); }
    else if (!targetKind && (!text.includes("Burnlist progress") || !cells.some((cell) => ["━", "■", "□"].includes(cell.char)))) fail("support semantics missing");
    const fixture = targetKind ? `progress-target-${targetKind}` : "progress-components";
    const base: TerminalFrame = { schema: FRAME_SCHEMA, fixture, checkpoint, viewport: { width, height }, semanticText, cells, renderer, fixtureSha256: sourceSha256 };
    if (!targetKind) return base;
    const target = locate(compiled.ir.root, targetKind), semanticSignature = sha(JSON.stringify({ semanticText, cells }));
    return { ...base, targetKind, semanticSignature, trace: { fixtureSource: fixturePath, fixtureSourceSha256: sha(fixtureSource), targetPath: target.path, targetSource: target.node.source, targetNodeSha256: sha(JSON.stringify(target.node)) } };
  } finally { setup.renderer.off("frame", snapshot); await act(async () => app.unmount()); setup.renderer.destroy(); reactGlobal.IS_REACT_ACT_ENVIRONMENT = previous; }
}
export async function buildProgressFrames() {
  const source = await sourceData(), renderer = await provenance(source.digest), frames: any[] = [];
  for (const width of [20, 36, 60, 120]) for (const [checkpoint, payload] of Object.entries(states)) frames.push(await render(width, checkpoint, payload, source.digest, renderer));
  for (const kind of targetKinds) frames.push(await render(120, "ready", targetPayloads[kind], source.digest, renderer, targetFile(kind), kind));
  const files: Record<string, string> = {};
  for (const frame of frames) { const text = stable(frame), name = `${frame.fixture}.${frame.viewport.width}x${frame.viewport.height}.${frame.checkpoint}.${sha(text).slice(0, 16)}.json`; files[name] = text; }
  const entries = Object.entries(files).map(([path, text]) => { const frame = JSON.parse(text); return { id: `${frame.fixture}:${frame.viewport.width}x${frame.viewport.height}:${frame.checkpoint}`, fixture: frame.fixture, path, sha256: sha(text), fixtureSha256: frame.fixtureSha256, checkpoint: frame.checkpoint, viewport: frame.viewport, ...(frame.targetKind ? { targetKind: frame.targetKind, semanticSignature: frame.semanticSignature, trace: frame.trace } : {}) }; }).sort((a, b) => a.id.localeCompare(b.id));
  const byKind = new Map(entries.filter((entry) => entry.targetKind).map((entry) => [entry.targetKind, entry]));
  const support = entries.filter((entry) => !entry.targetKind).map((frame) => ({ recordId: `progress-components:support:${frame.id}`, target: `support:frame:${frame.id}`, fixture: frame.fixture, frameId: frame.id, artifactPath: `dashboard/src/generated/terminal-progress-frames/${frame.path}`, artifactSha256: frame.sha256, implementationExport: "tui/src/oven-runtime/components/terminal-oven-viewport.tsx#TerminalOvenViewport", sourceFiles: source.files }));
  const mapped = [...atomKinds].sort(([left], [right]) => left.localeCompare(right)).map(([atomId, kind]) => { const frame = byKind.get(kind)!; return { recordId: `progress-components:${atomId}`, target: `atom:${atomId}`, fixture: frame.fixture, frameId: frame.id, artifactPath: `dashboard/src/generated/terminal-progress-frames/${frame.path}`, artifactSha256: frame.sha256, implementationExport: implementations[kind], targetKind: kind, semanticSignature: frame.semanticSignature, trace: frame.trace, sourceFiles: source.files }; });
  return { files, index: stable({ schema: "burnlist-terminal-progress-frame-index@1", generator: "burnlist-b7-progress@1", provenance: renderer, entries }), evidence: stable({ schema: "burnlist-terminal-progress-evidence-index@1", generator: "burnlist-b7-progress@1", records: [...support, ...mapped] }) };
}
async function desired() { return buildProgressFrames(); }
async function check() {
  const want = await desired(), names = new Set([...Object.keys(want.files), "index.json"]), actual = await readdir(generated).catch(() => []);
  if (actual.length !== names.size || actual.some((name) => !names.has(name))) fail("generated outputs are missing or extra");
  for (const [name, text] of Object.entries(want.files)) if (await Bun.file(join(generated, name)).text() !== text) fail(`stale frame ${name}`);
  if (await Bun.file(indexPath).text() !== want.index || await Bun.file(evidencePath).text() !== want.evidence) fail("stale index or evidence");
  for (const text of [...Object.values(want.files), want.index, want.evidence]) if (text.split("\n").length - 1 > 400) fail("generated output exceeds 400 lines");
}
async function write() {
  const want = await desired(); await mkdir(generated, { recursive: true }); const names = new Set([...Object.keys(want.files), "index.json"]);
  for (const [name, text] of Object.entries(want.files)) await atomic(join(generated, name), text);
  await atomic(indexPath, want.index); await atomic(evidencePath, want.evidence);
  for (const name of await readdir(generated)) if (!names.has(name)) await rm(join(generated, name));
  for (const text of [...Object.values(want.files), want.index, want.evidence]) if (text.split("\n").length - 1 > 400) fail("generated output exceeds 400 lines");
}
if (import.meta.main) { const mode = process.argv[2]; (mode === "--write" ? write() : mode === "--check" ? check() : Promise.reject(new Error("usage: --write or --check"))).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }); }
