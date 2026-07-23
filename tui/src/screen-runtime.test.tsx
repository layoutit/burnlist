import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { compileGlyph } from "../../src/glyph/glyph-compile.mjs";
import burnlistSource from "../screens/burnlist.glyph" with { type: "text" };
import homeSource from "../screens/home.glyph" with { type: "text" };
import itemSource from "../screens/item.glyph" with { type: "text" };
import ovenSource from "../screens/oven.glyph" with { type: "text" };
import ovensSource from "../screens/ovens.glyph" with { type: "text" };
import { detailItems } from "./detail-items";
import { ScreenRuntime, type ScreenRuntimeProps } from "./screen-runtime";
import type { BurnlistSummary, LandingSnapshot, OvenDataSnapshot, OvenPackageDetail, ProgressSnapshot } from "./types";

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
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAAAAAAAAAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3AAAAAAAAAABJRU5EAAAAAA==";
const image = (label: string) => ({ label, src: png, width: 2, height: 2 });
const visualData: OvenDataSnapshot = {
  ovenId: "visual-parity",
  payload: {
    schema: "burnlist-visual-parity-data@1",
    differentialTesting: { scenarioCatalog: { selectedScenarioId: "main", scenarios: [{ id: "main", label: "Dashboard", frameCount: 2 }] } },
    domains: [{ id: "target", label: "Target", isolation: "render-pass", qualification: "target", tolerance: { rationale: "Exact render boundary." } }],
    comparisons: [0, 1].map((frame) => ({
      id: `f${frame}`, label: frame ? "Detail" : "Landing", frame, status: "pass",
      domains: { target: { label: "Target", status: "pass", reference: image("Reference"), candidate: image("Candidate"), diff: image("Diff"), difference: { changedPixels: 0, totalPixels: 4, ratio: 0, meanAbsoluteDelta: 0, maximumAbsoluteDelta: 0 } } },
    })),
  },
  validated: true,
};
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
    expect(frame).toContain("BURNLIST");
    expect(frame).toContain("PROGRESS");
    expect(frame).not.toContain("UPDATED");
    root.unmount();
  });

  test("renders navigable Checklist items and marks the latest completion", async () => {
    const { frame, root } = await renderFrame(120, 36, props({
      screen: parsed(burnlistSource), progress, selectedBurnlist: checklistBurnlist,
      activeOven: ovens[0]!, ovenLenses: [ovens[0]!], itemIndex: 1,
    }));
    expect(frame).toContain("Burnlist items");
    expect(frame).toContain("Render item detail");
    expect(frame).toContain("Render the fire");
    expect(frame).toContain("LATEST");
    expect(frame).toContain("50%");
    expect(frame).toMatch(/[.:;+=xX#%@]/u);
    root.unmount();
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

  test("renders a Visual Parity frame as supersampled image triplets", async () => {
    const items = detailItems(ovens[1]!, null, visualData);
    const { frame, root } = await renderFrame(120, 34, props({
      screen: parsed(itemSource), selectedBurnlist: visualBurnlist, activeOven: ovens[1]!,
      ovenData: visualData, selectedItem: items[1]!, itemIndex: 1,
    }));
    expect(frame).toContain("Reference");
    expect(frame).toContain("Candidate");
    expect(frame).toContain("Diff");
    expect(frame).toContain("LATEST");
    expect(frame).toContain("2×2");
    expect(frame).toMatch(/[▗▖▄▝▐▞▟▘▚▌▙▀▜▛█]/u);
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
});
