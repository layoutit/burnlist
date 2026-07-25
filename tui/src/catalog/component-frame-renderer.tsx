#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestRenderer, ManualClock } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { componentPairIds, type ComponentPairId } from "./component-pair-fixture";
import { TerminalComponentPair } from "./component-pair-surface";
import { TERMINAL_LOADING_CAPTURE } from "../loading-cadence";
import { FRAME_INDEX_SCHEMA, FRAME_SCHEMA, type RendererProvenance, type TerminalFrame } from "./frame-contract";
import { cellsFromFrame } from "./frame-renderer";
import { orderedSemanticText } from "../terminal-accessibility";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = resolve(root, "dashboard/src/generated/terminal-component-frames");
const indexPath = join(generated, "index.json");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const fail = (message: string): never => { throw new Error(`terminal component frames: ${message}`); };

async function atomic(path: string, text: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, text); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

async function withLock<T>(work: () => Promise<T>) {
  const lock = `${generated}.lock`;
  await mkdir(dirname(generated), { recursive: true });
  try { await writeFile(lock, String(process.pid), { flag: "wx" }); }
  catch { fail("generator lock is already held"); }
  try { return await work(); }
  finally { await rm(lock, { force: true }); }
}

async function provenance(): Promise<{ sourceSha256: string; renderer: RendererProvenance }> {
  const manifest = JSON.parse(await readFile(resolve(root, "dashboard/src/terminal-component-coverage.json"), "utf8")) as {
    entries: Array<{ storyFile: string }>;
  };
  const sources = [
    "dashboard/src/terminal-component-coverage.json",
    ...manifest.entries.map((entry) => entry.storyFile),
    "dashboard/src/components/TerminalFrame/TerminalPairPreview.tsx",
    "tui/src/catalog/component-frame-renderer.tsx",
    "tui/src/catalog/component-pair-fixture.ts",
    "tui/src/catalog/component-pair-surface.tsx",
    "tui/src/catalog/component-media-fixture.ts",
    "tui/src/glyph-image.tsx",
    "tui/src/loading-cadence.ts",
    "tui/src/loading-star.tsx",
    "tui/src/png-glyph.ts",
    "tui/src/terminal-line-chart.tsx",
    "tui/src/oven-runtime/components/media-components.tsx",
    "tui/src/oven-runtime/components/progress-glyph.ts",
    "tui/src/catalog/frame-renderer.tsx",
    "tui/src/terminal-accessibility.ts",
    "tui/src/terminal-chrome.tsx",
    "tui/src/theme.ts",
    "tui/package.json",
    "tui/package-lock.json",
  ];
  const sourceSha256 = sha((await Promise.all(sources.map(async (path) => `${path}\n${await readFile(resolve(root, path), "utf8")}`))).join("\n"));
  const lock = JSON.parse(await readFile(resolve(root, "tui/package-lock.json"), "utf8"));
  const record = (name: string) => {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry?.version || !entry?.integrity) fail(`lockfile is missing pinned ${name}`);
    return { version: String(entry.version), integrity: String(entry.integrity) };
  };
  const bun = record("bun");
  if (Bun.version !== bun.version) fail(`Bun runtime ${Bun.version} does not match pinned ${bun.version}`);
  const packages = ["@opentui/core", "@opentui/react", "glyphcss", "@glyphcss/core", "@glyphcss/effects"];
  return {
    sourceSha256,
    renderer: {
      sourceSha256,
      bun: { runtimeVersion: Bun.version, packageVersion: bun.version, integrity: bun.integrity },
      packages: Object.fromEntries(packages.map((name) => [name, record(name)])),
    },
  };
}

async function render(id: ComponentPairId, renderer: RendererProvenance, fixtureSha256: string): Promise<TerminalFrame> {
  const width = 72, height = 10;
  const checkpoint = id === "spinner" ? TERMINAL_LOADING_CAPTURE.checkpoint : "default";
  const setup = await createTestRenderer({ width, height, clock: new ManualClock(), targetFps: 60, useThread: false });
  const rootNode = createRoot(setup.renderer);
  let recorded: { frame: string; buffers: { char: Uint32Array; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array } } | undefined;
  const snapshot = () => {
    const buffer = setup.renderer.currentRenderBuffer, raw = buffer.buffers;
    recorded = {
      frame: new TextDecoder().decode(buffer.getRealCharBytes(true)),
      buffers: {
        char: new Uint32Array(raw.char), fg: new Uint16Array(raw.fg),
        bg: new Uint16Array(raw.bg), attributes: new Uint32Array(raw.attributes),
      },
    };
  };
  setup.renderer.on("frame", snapshot);
  try {
    flushSync(() => rootNode.render(<TerminalComponentPair id={id} width={width} animationPhase={id === "spinner" ? TERMINAL_LOADING_CAPTURE.phase : undefined} />));
    await setup.renderOnce();
    const snapshotData = recorded;
    if (!snapshotData) throw new Error(`terminal component frames: ${id} produced no OpenTUI frame`);
    const buffer = setup.renderer.currentRenderBuffer;
    const frame: TerminalFrame = {
      schema: FRAME_SCHEMA,
      fixture: `component-${id}`,
      checkpoint,
      viewport: { width, height },
      semanticText: orderedSemanticText(snapshotData.frame),
      cells: cellsFromFrame(snapshotData.frame, width, height, snapshotData.buffers),
      renderer,
      fixtureSha256,
    };
    if (!frame.semanticText.join("").trim() || buffer.width !== width || buffer.height !== height) fail(`${id} produced invalid semantics or dimensions`);
    return frame;
  } finally {
    setup.renderer.off("frame", snapshot);
    rootNode.unmount();
    setup.renderer.destroy();
  }
}

async function desired() {
  const source = await provenance();
  const frames: TerminalFrame[] = [];
  for (const id of componentPairIds) frames.push(await render(id, source.renderer, source.sourceSha256));
  const files: Record<string, string> = {};
  const entries = frames.map((frame) => {
    const text = JSON.stringify(frame);
    const digest = sha(text);
    const path = `${frame.fixture}.72x10.${frame.checkpoint}.${digest.slice(0, 16)}.json`;
    files[path] = text;
    return {
      id: `${frame.fixture}:72x10:${frame.checkpoint}`, fixture: frame.fixture, path,
      sha256: digest, fixtureSha256: frame.fixtureSha256,
      checkpoint: frame.checkpoint, viewport: frame.viewport,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const index = `${JSON.stringify({
    schema: FRAME_INDEX_SCHEMA,
    generator: "burnlist-terminal-component-pairs@1",
    provenance: source.renderer,
    entries,
  }, null, 2)}\n`;
  return { files, index };
}

async function check() {
  const wanted = await desired(), names = new Set([...Object.keys(wanted.files), "index.json"]);
  let actual: string[] = [];
  try { actual = (await readdir(generated)).filter((name) => name.endsWith(".json")); } catch {}
  if (actual.length !== names.size || actual.some((name) => !names.has(name))) fail("generated outputs are missing or extra");
  for (const [name, text] of Object.entries(wanted.files)) if (await readFile(join(generated, name), "utf8") !== text) fail(`stale frame ${name}`);
  if (await readFile(indexPath, "utf8") !== wanted.index) fail("stale index");
  const untracked = (await Bun.$`git -C ${root} ls-files --others --exclude-standard -- dashboard/src/generated/terminal-component-frames`.text()).trim();
  if (untracked) fail(`untracked generated output ${untracked.replaceAll("\n", ", ")}`);
}

async function write() {
  const wanted = await desired();
  await mkdir(generated, { recursive: true });
  const names = new Set([...Object.keys(wanted.files), "index.json"]);
  const old = (await readdir(generated)).filter((name) => name.endsWith(".json") && !names.has(name));
  for (const [name, text] of Object.entries(wanted.files)) await atomic(join(generated, name), text);
  await atomic(indexPath, wanted.index);
  for (const name of old) await rm(join(generated, name));
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") fail("usage: --write or --check");
  await withLock(() => mode === "--write" ? write() : check());
}

if (import.meta.main) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
