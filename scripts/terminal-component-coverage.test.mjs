import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const dashboard = resolve(root, "dashboard/src");

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  }));
  return nested.flat();
}

const quoted = (source) => [...source.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
const sorted = (values) => [...values].sort();

test("every catalogued console component has one source-backed terminal pair", async () => {
  const manifest = JSON.parse(await readFile(resolve(dashboard, "terminal-component-coverage.json"), "utf8"));
  assert.equal(manifest.schema, "burnlist-terminal-component-coverage@1");

  const storyPaths = (await files(dashboard)).filter((path) => path.endsWith(".stories.tsx"));
  const stories = await Promise.all(storyPaths.map(async (path) => ({
    path,
    source: await readFile(path, "utf8"),
  })));
  const titles = stories.flatMap(({ source }) => [...source.matchAll(/\btitle:\s*"([^"]+)"/gu)].map((match) => match[1]));
  const consoleTitles = titles.filter((title) => title.startsWith("UI/") || title.startsWith("Patterns/"));
  assert.deepEqual(sorted(consoleTitles), sorted(manifest.entries.map((entry) => entry.consoleStory)));
  assert.equal(new Set(consoleTitles).size, consoleTitles.length);
  assert.equal(titles.some((title) => title.startsWith("Ovens/")), false);
  assert.equal(titles.some((title) => title.startsWith("Terminal counterparts/")), false);
  assert.equal(titles.some((title) => /General console-terminal|Terminal (?:controls|list|heading)/u.test(title)), false);
  for (const entry of manifest.entries) {
    const expectedPath = resolve(root, entry.storyFile);
    const consoleStory = stories.find(({ path }) => path === expectedPath);
    assert.ok(consoleStory, `${entry.consoleStory} is missing`);
    assert.match(consoleStory.source, new RegExp(`title:\\s*"${entry.consoleStory}"`, "u"));
    assert.match(consoleStory.source, new RegExp(`component:\\s*${entry.consoleComponent}\\b`, "u"));
    assert.match(consoleStory.source, /import \{ PairPreview \}/u);
    assert.match(consoleStory.source, /componentPairFixture/u);
    assert.match(consoleStory.source, /\bargs\s*:/u, `${entry.consoleStory} declares no interactive controls`);
    const exportStart = consoleStory.source.search(new RegExp(`export const ${entry.pairedExport}\\b`, "u"));
    assert.notEqual(exportStart, -1, `${entry.consoleStory} has no ${entry.pairedExport} export`);
    const remainder = consoleStory.source.slice(exportStart);
    const nextExport = remainder.slice(1).search(/\nexport const \w+\b/u);
    const pairedSource = nextExport < 0 ? remainder : remainder.slice(0, nextExport + 1);
    assert.match(pairedSource, new RegExp(`<PairPreview component="${entry.id}"`, "u"));
    assert.match(pairedSource, /\brender:\s*\(args\)/u, `${entry.consoleStory} does not consume live Storybook args`);
    assert.match(pairedSource, /terminalArgs=\{/u, `${entry.consoleStory} does not pass live args to its terminal counterpart`);
  }

  const pairPreview = await readFile(resolve(dashboard, "components/TerminalFrame/TerminalPairPreview.tsx"), "utf8");
  assert.match(pairPreview, /LiveTerminalFrame/u);
  assert.doesNotMatch(pairPreview, /componentPairFrameEntries|TerminalFrame entry|generated\/terminal-component-frames/u);
  assert.match(pairPreview, /terminalArgs:\s*ComponentPairLiveArgs/u);

  const terminalSource = await readFile(resolve(root, "tui/src/catalog/component-pair-surface.tsx"), "utf8");
  for (const entry of manifest.entries) {
    assert.match(terminalSource, new RegExp(`export const ${entry.terminalExport}\\b`, "u"));
    assert.match(terminalSource, new RegExp(`(?:^|\\n)\\s*(?:"${entry.id}"|${entry.id}): ${entry.terminalExport},`, "u"));
  }

  const fixtureSource = await readFile(resolve(root, "tui/src/catalog/component-pair-fixture.ts"), "utf8");
  const fixtureIds = quoted(fixtureSource.match(/componentPairIds = \[([\s\S]*?)\] as const/u)?.[1] || "");
  assert.deepEqual(sorted(fixtureIds), sorted(manifest.entries.map((entry) => entry.id)));

  const frameRoot = resolve(dashboard, "generated/terminal-component-frames");
  const index = JSON.parse(await readFile(resolve(frameRoot, "index.json"), "utf8"));
  const entries = index.entries.filter((entry) => entry.fixture.startsWith("component-"));
  assert.deepEqual(sorted(entries.map((entry) => entry.fixture)), sorted(manifest.entries.map((entry) => `component-${entry.id}`)));
  const measuredViewports = {
    "component-line-chart": "72x8",
    "component-top-card": "72x12",
    "component-visual-parity-media": "96x26",
  };
  for (const entry of entries) {
    const viewport = measuredViewports[entry.fixture] || "72x10";
    assert.equal(entry.id, `${entry.fixture}:${viewport}:${entry.fixture === "component-spinner" ? "spark" : "default"}`);
    const frame = JSON.parse(await readFile(resolve(frameRoot, entry.path), "utf8"));
    assert.equal(frame.fixtureSha256, entry.fixtureSha256);
    assert.equal(frame.renderer.sourceSha256, entry.fixtureSha256);
    assert.ok(frame.semanticText.join("").trim(), `${entry.id} has no terminal semantics`);
  }
});
