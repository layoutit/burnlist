import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { compileGlyph } from "../../src/glyph/glyph-compile.mjs";
// @ts-expect-error Production compiler intentionally remains JavaScript.
import { compileOven } from "../../src/ovens/dsl/oven-compile.mjs";
import { adaptChecklist } from "../../dashboard/src/lib/checklist-adapter";
import burnlistSource from "../screens/burnlist.glyph" with { type: "text" };
import homeSource from "../screens/home.glyph" with { type: "text" };
import itemSource from "../screens/item.glyph" with { type: "text" };
import ovenSource from "../screens/oven.glyph" with { type: "text" };
import ovensSource from "../screens/ovens.glyph" with { type: "text" };
import { detailItems } from "./detail-items";
import { ScreenRuntime, type ScreenRuntimeProps } from "./screen-runtime";
import type { BurnlistSummary, LandingSnapshot, OvenPackageDetail, ProgressSnapshot } from "./types";
import { admitTerminalOven } from "./oven-runtime/terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./oven-runtime/components/terminal-capabilities";
import { streamingDiffFixture } from "./catalog/streaming-diff-fixture";

const renderers: Array<{ destroy(): void }> = [];
afterEach(() => { while (renderers.length) renderers.pop()?.destroy(); });

const checklistBurnlist: BurnlistSummary = {
  id: "term-ui", repo: "demo", repoKey: "abc", repoRoot: "/demo", title: "Terminal UI",
  planPath: "/demo/burnlist.md", planLabel: "burnlist.md", status: "active", statusLabel: "Active",
  total: 4, done: 2, remaining: 2, percent: 50, errors: 0, warnings: 0,
  updatedAt: "2026-07-23T10:00:00Z", lastCompletedAt: "2026-07-23T09:00:00Z", ovenId: "checklist", ovenName: "Checklist",
  href: "/r/abc/term-ui/o/checklist", progressLabel: "2/4 items",
};
const visualBurnlist: BurnlistSummary = {
  ...checklistBurnlist, id: "visual", title: "Render review", planPath: null, planLabel: null,
  total: 2, done: 2, remaining: 0, percent: 100, ovenId: "visual-parity", ovenName: "Visual Parity",
  href: "/r/abc/o/visual-parity", progressLabel: "2/2 target frames",
};
const ovens = [
  { id: "checklist", name: "Checklist", description: "Burnlist progress and events.", version: "0.1.0", builtIn: true, repoKey: null, contract: "checklist-progress@1", dataInput: "producer-managed" as const },
  { id: "visual-parity", name: "Visual Parity", description: "Compare isolated render domains.", version: "0.1.0", builtIn: true, repoKey: null, contract: "burnlist-visual-parity-data@1", dataInput: "json-payload" as const },
  { id: "private-view", name: "Private View", description: "Repository Oven.", version: "1", builtIn: false, repoKey: "abc", contract: "private@1", dataInput: "json-payload" as const },
];
const landing: LandingSnapshot = {
  generatedAt: "now",
  projects: [{ repoKey: "abc", displayName: "demo", canonicalRoot: "/demo", health: "healthy", counts: { total: 2, active: 1 } }],
  burnlists: [checklistBurnlist, visualBurnlist],
  ovens,
};
const progress: ProgressSnapshot = {
  generatedAt: "now", repoKey: "abc", title: "Terminal UI", repo: "demo", planPath: "/demo/burnlist.md",
  planLabel: "burnlist.md", total: 4, done: 2, remaining: 2, percent: 50, warnings: [],
  goal: { available: true, label: "Goal", path: "goal.md", sections: [{ title: "Goal", body: "Ship the terminal view." }] },
  active: [{ id: "ui-03", title: "Render item detail", fields: { description: "Show every field.", acceptance: "The detail is readable." } }],
  completed: [
    { id: "ui-01", title: "Build shell", completedAt: "2026-07-22T09:00:00Z", detail: "Shell delivered." },
    { id: "ui-02", title: "Render the fire", completedAt: "2026-07-23T09:00:00Z", detail: "Animated with glyphcss." },
  ],
};
const checklistSource = readFileSync(new URL("../../ovens/checklist/checklist.oven", import.meta.url), "utf8");
const compiledChecklist = compileOven(checklistSource);
if (!compiledChecklist.ok) throw new Error("Checklist fixture did not compile.");
function checklistRuntime(value: ProgressSnapshot, width = 52, height = 26) {
  const payload = adaptChecklist({
    ...value,
    history: value.history ?? [],
    active: value.active.map((item) => ({ ...item, fields: item.fields ?? {} })),
    completed: value.completed.map((item) => ({ ...item, detail: item.detail ?? "" })),
  });
  return admitTerminalOven(compiledChecklist.ir, { status: "ready", payload }, { viewport: { width, height } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
}
const ovenDetail: OvenPackageDetail = {
  ...ovens[1]!, instructions: "# Visual Parity\n\nCompare trusted reference and candidate frames.\n\n## Data Shape\n\nRead-only JSON payload.",
  oven: "<oven />", ovenRevision: `o1-sha256:${"a".repeat(64)}`,
  ir: { schema: "burnlist-oven-ir@1", id: "visual-parity", version: "0.1.0", contract: "burnlist-visual-parity-data@1", theme: "visual-parity", root: [], requirements: { components: ["domain-tabs", "frame-card", "metric-tiles"] } },
};

function parsed(source: string) {
  const result = compileGlyph(source);
  if (!result.ok) throw new Error(result.diagnostics.map((entry) => entry.message).join("\n"));
  return result.ir;
}

function props(overrides: Partial<ScreenRuntimeProps> = {}): ScreenRuntimeProps {
  return {
    screen: parsed(homeSource), landing, progress: null, selectedBurnlist: null, activeOven: null,
    ovenDetail: null, ovenLenses: [], ovenData: null, selectedItem: null, itemIndex: 0, domainIndex: 0,
    focusId: "burnlists", selections: { burnlists: 0, ovens: 0 }, streamStatus: "live", ...overrides,
  };
}

async function renderFrame(width: number, height: number, runtimeProps: ScreenRuntimeProps) {
  const setup = await createTestRenderer({ width, height });
  renderers.push(setup.renderer);
  const root = createRoot(setup.renderer);
  flushSync(() => root.render(<ScreenRuntime {...runtimeProps} />));
  await setup.renderOnce();
  return { frame: setup.captureCharFrame(), root };
}

describe("dashboard-shaped .glyph runtime", () => {
  test("keeps the landing focused entirely on Burnlists", async () => {
    const { frame, root } = await renderFrame(120, 36, props());
    expect(frame).toContain("⟁");
    expect(frame).toContain("Burnlists");
    expect(frame).toContain("Terminal UI");
    expect(frame).toContain("o:Oven catalog");
    expect(frame).not.toContain("checklist-progress@1");
    expect(frame).not.toContain("Private View");
    expect(frame).not.toContain("╭");
    root.unmount();
  });

  test("keeps landing headings, project labels, and values on one shared grid", async () => {
    const { frame, root } = await renderFrame(200, 42, props());
    const lines = frame.split("\n");
    const columns = lines.find((line) => line.includes("OVEN") && line.includes("STATUS"))!;
    const project = lines.find((line) => line.includes("demo") && line.includes("2 Burnlists"))!;
    const row = lines.find((line) => line.includes("Terminal UI") && line.includes("Checklist"))!;
    expect(project.indexOf("demo")).toBe(3);
    expect(row.indexOf("Terminal UI")).toBe(3);
    expect(row.indexOf("Checklist")).toBe(columns.indexOf("OVEN"));
    expect(lines[0].indexOf("⟁")).toBe(3);
    expect(lines[0]).toContain("⟁ Burnlist 2 Burnlists · 1 project · LIVE");
    expect(columns).not.toContain("BURNLIST");
    const footer = lines.find((line) => line.includes("↑/↓:navigate"))!;
    expect(footer.indexOf("↑")).toBe(3);
    root.unmount();
  });

  test("opens a generic-only Oven catalog", async () => {
    const { frame, root } = await renderFrame(120, 34, props({ screen: parsed(ovensSource), focusId: "ovens" }));
    expect(frame).toContain("Oven catalog");
    expect(frame).toContain("Checklist");
    expect(frame).toContain("Visual Parity");
    expect(frame).not.toContain("Private View");
    root.unmount();
  });

  test("hides secondary Burnlist fields at compact widths", async () => {
    const { frame, root } = await renderFrame(70, 30, props());
    expect(frame).toContain("Burnlist");
    expect(frame).toContain("PROGRESS");
    expect(frame).not.toContain("UPDATED");
    root.unmount();
  });

  test("renders navigable Checklist items and marks the latest completion", async () => {
    const items = detailItems(ovens[0]!, progress, null);
    const { frame, root } = await renderFrame(120, 36, props({
      screen: parsed(burnlistSource), progress, selectedBurnlist: checklistBurnlist,
      activeOven: ovens[0]!, ovenLenses: [ovens[0]!], itemIndex: 1, selectedItem: items[1]!,
      ovenRuntime: checklistRuntime(progress),
    }));
    expect(frame).toContain("Current");
    expect(frame).toContain("Build shell");
    expect(frame).toContain("Render the fire");
    expect(frame).toContain("LATEST");
    expect(frame).toContain("50%");
    expect(frame).toMatch(/[.:;+=xX#%@]/u);
    root.unmount();
  });

  test("shows refresh activity without moving screen content", async () => {
    const idle = await renderFrame(120, 36, props());
    const busy = await renderFrame(120, 36, props({ notice: { message: "Refreshing Burnlist data…", tone: "info" } }));
    const idleLines = idle.frame.split("\n");
    const busyLines = busy.frame.split("\n");
    expect(busyLines[0]).toContain("Refreshing");
    expect(busyLines.findIndex((line) => line.includes("Terminal UI"))).toBe(idleLines.findIndex((line) => line.includes("Terminal UI")));
    expect(busyLines.findIndex((line) => line.includes("↑/↓:navigate"))).toBe(idleLines.findIndex((line) => line.includes("↑/↓:navigate")));
    idle.root.unmount();
    busy.root.unmount();
  });

  test("clips a long detail table above the footer", async () => {
    const longProgress: ProgressSnapshot = {
      ...progress,
      total: 20,
      done: 0,
      remaining: 20,
      percent: 0,
      active: Array.from({ length: 20 }, (_, index) => ({
        id: `task-${String(index).padStart(2, "0")}`,
        title: `Task ${String(index).padStart(2, "0")}`,
      })),
      completed: [],
    };
    for (const height of [26, 32, 40, 60]) {
      const { frame, root } = await renderFrame(100, height, props({
        screen: parsed(burnlistSource),
        progress: longProgress,
        selectedBurnlist: checklistBurnlist,
        activeOven: ovens[0]!,
        ovenLenses: [ovens[0]!],
        itemIndex: 19,
        selectedItem: detailItems(ovens[0]!, longProgress, null)[19]!,
        ovenRuntime: checklistRuntime(longProgress),
      }));
      const lines = frame.split("\n");
      const selectedRow = lines.findIndex((line) => line.includes("task-19"));
      const footerRow = lines.findIndex((line) => line.includes("↑/↓:inspect"));
      expect(selectedRow).toBeGreaterThan(-1);
      expect(selectedRow).toBeLessThan(footerRow);
      expect(lines[footerRow]).not.toContain("task-");
      root.unmount();
    }
  });

  test("ellipsizes long detail chrome without wrapping or colliding", async () => {
    const longBurnlist = {
      ...checklistBurnlist,
      repo: "a-project-name-that-is-far-too-long-for-the-sidebar",
      id: "a-burnlist-identifier-that-cannot-fit",
      title: "A deliberately enormous Burnlist title that must never run into the animated fire",
      ovenName: "An exceptionally verbose Oven display name",
    };
    const longOven = {
      ...ovens[0]!,
      name: "An exceptionally verbose Oven display name",
      contract: "an-exceptionally-verbose-contract-name@999",
    };
    for (const width of [70, 88, 100, 120]) {
      const { frame, root } = await renderFrame(width, 32, props({
        screen: parsed(burnlistSource),
        progress,
        selectedBurnlist: longBurnlist,
        activeOven: longOven,
        ovenLenses: [longOven, { ...ovens[1]!, name: "Another Oven lens with a very long name" }],
      }));
      const lines = frame.split("\n");
      expect(lines[0]).toContain("…");
      expect(lines.filter((line) => line.includes("deliberately enormous")).length).toBeLessThanOrEqual(2);
      expect(lines.filter((line) => line.includes("exceptionally verbose")).length).toBeLessThanOrEqual(3);
      expect(lines.at(-2)).toContain("↑/↓:inspect");
      root.unmount();
    }
  });

  test("renders the selected Checklist item's complete detail", async () => {
    const items = detailItems(ovens[0]!, progress, null);
    const { frame, root } = await renderFrame(110, 34, props({
      screen: parsed(itemSource), progress, selectedBurnlist: checklistBurnlist,
      activeOven: ovens[0]!, selectedItem: items[1]!, itemIndex: 1,
    }));
    expect(frame).toContain("Render the fire");
    expect(frame).toContain("LATEST");
    expect(frame).toContain("COMPLETION DETAIL");
    expect(frame).toContain("Animated with glyphcss.");
    root.unmount();
  });

  test("inspects a generic Oven package rather than an installed binding", async () => {
    const { frame, root } = await renderFrame(120, 34, props({ screen: parsed(ovenSource), activeOven: ovens[1]!, ovenDetail }));
    expect(frame).toContain("GENERIC");
    expect(frame).toContain("DECLARED VIEW");
    expect(frame).toContain("domain-tabs → frame-card → metric-tiles");
    expect(frame).toContain("Compare trusted reference and candidate frames.");
    root.unmount();
  });

  test("keeps retained Streaming Diff session errors and its footer inside narrow and short viewports", async () => {
    const source = readFileSync(new URL("../../ovens/streaming-diff/streaming-diff.oven", import.meta.url), "utf8");
    // @ts-expect-error Production compiler intentionally remains JavaScript.
    const oven = (await import("../../src/ovens/dsl/oven-compile.mjs")).compileOven(source); if (!oven.ok) throw new Error("fixture compile failed");
    for (const [width, height] of [[40, 18], [80, 24]] as const) {
      const runtime = admitTerminalOven(oven.ir, { status: "ready", payload: streamingDiffFixture.payload }, { viewport: { width, height: height - 4 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
      const navigation = { page: "session" as const, feeds: [], selectedFeed: 0, selectedCard: 0, selectedFile: 0, expandedFile: null, session: { identity: streamingDiffFixture.raw.identity, updatedAt: streamingDiffFixture.raw.updatedAt, href: "/stream" }, feedStatus: "ready" as const, sessionError: "The stream disconnected while this retained card remains readable and must not cross the footer.", restoreFocus: "oven-list" as const };
      const { frame, root } = await renderFrame(width, height, props({ screen: parsed(ovenSource), ovenRuntime: runtime, streamingNavigation: navigation }));
      const lines = frame.split("\n"); expect(frame).toContain("stream disconnected"); expect(frame).toContain("q/esc:back"); expect(lines.at(-2)).toContain("q/esc:back"); expect(lines.every((line) => Array.from(line).length <= width)).toBe(true); root.unmount();
    }
  });

  test("keeps Streaming Diff feed loading, error, and empty states distinct", async () => {
    for (const [status, error, expected] of [["loading", "", "Loading recent feeds."], ["error", "Feed unavailable.", "Feed unavailable."], ["empty", "", "No recent feeds."]] as const) for (const [width, height] of [[40, 18], [80, 24]] as const) {
      const navigation = { page: "feeds" as const, feeds: [], selectedFeed: 0, selectedCard: 0, selectedFile: 0, expandedFile: null, session: null, feedStatus: status as "loading" | "error" | "empty", sessionError: error, restoreFocus: "oven-list" as const };
      const { frame, root } = await renderFrame(width, height, props({ screen: parsed(ovenSource), streamingNavigation: navigation }));
      expect(frame).toContain(expected); expect(frame).toContain("q/esc:back"); expect(frame.split("\n").every((line) => Array.from(line).length <= width)).toBe(true); root.unmount();
    }
  });
});
