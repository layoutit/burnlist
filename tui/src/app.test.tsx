import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { App } from "./app";

const originalFetch = globalThis.fetch;
const renderers: Array<{ destroy(): void }> = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  while (renderers.length) renderers.pop()?.destroy();
});

const burnlist = {
  id: "demo-01", repo: "demo", repoKey: "repo1", repoRoot: "/demo", title: "Demo Burnlist",
  planPath: "/demo/burnlist.md", planLabel: "burnlist.md", status: "active", statusLabel: "Active",
  total: 2, done: 1, remaining: 1, percent: 50, errors: 0, warnings: 0, updatedAt: "2026-07-23T10:00:00Z",
  lastCompletedAt: "2026-07-23T09:00:00Z", ovenId: "checklist", ovenName: "Checklist", href: "/demo", progressLabel: "1/2 items",
};
const oven = {
  id: "checklist", name: "Checklist", description: "Burnlist progress and events.", version: "0.1.0",
  builtIn: true, repoKey: null, contract: "checklist-progress@1", dataInput: "producer-managed",
};
const progress = {
  generatedAt: "now", repoKey: "repo1", title: "Demo Burnlist", repo: "demo", planPath: "/demo/burnlist.md", planLabel: "burnlist.md",
  total: 2, done: 1, remaining: 1, percent: 50, warnings: [],
  active: [{ id: "demo-02", title: "Current item", fields: { description: "Finish navigation." } }],
  completed: [{ id: "demo-01", title: "Latest completed", completedAt: "2026-07-23T09:00:00Z", detail: "Navigation foundation done." }],
};

function installApi() {
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/projects") return Response.json({ generatedAt: "now", projects: [{ repoKey: "repo1", displayName: "demo", canonicalRoot: "/demo", health: "healthy", counts: { total: 1, active: 1 } }] });
    if (path === "/api/burnlists") return Response.json({ generatedAt: "now", burnlists: [burnlist] });
    if (path === "/api/ovens") return Response.json({ ovens: [oven, { ...oven, id: "installed", name: "Installed", builtIn: false, repoKey: "repo1" }] });
    if (path === "/api/progress") return Response.json(progress);
    if (path === "/api/ovens/checklist") return Response.json({ oven: {
      ...oven, instructions: "# Checklist\n\nInspect the ordered checklist.", oven: "<oven />", ovenRevision: `o1-sha256:${"a".repeat(64)}`,
      ir: { schema: "burnlist-oven-ir@1", id: "checklist", version: "0.1.0", contract: "checklist-progress@1", theme: "checklist", root: [], requirements: { components: ["checklist-ledger"] } },
    } });
    return Response.json({ error: `unexpected ${path}` }, { status: 404 });
  }) as typeof fetch;
}

async function key(setup: Awaited<ReturnType<typeof createTestRenderer>>, value: string) {
  setup.mockInput.pressKey(value);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await setup.flush();
}

describe("TUI navigation stack", () => {
  test("uses o for the generic catalog, q for back, and escape only exits at root", async () => {
    installApi();
    const setup = await createTestRenderer({ width: 110, height: 34 });
    renderers.push(setup.renderer);
    const root = createRoot(setup.renderer);
    let shutdowns = 0;
    flushSync(() => root.render(<App serverUrl="http://127.0.0.1:4510" shutdown={() => { shutdowns += 1; }} />));
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist"));

    await key(setup, "o");
    await setup.waitForFrame((frame) => frame.includes("Oven catalog") && frame.includes("Checklist") && !frame.includes("Installed"));
    await setup.mockInput.pressKeys(["RETURN"]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await setup.flush();
    await setup.waitForFrame((frame) => frame.includes("GENERIC") && frame.includes("DECLARED VIEW"));
    await key(setup, "q");
    await setup.waitForFrame((frame) => frame.includes("Oven catalog"));
    await key(setup, "q");
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist") && frame.includes("o:Oven catalog"));

    await setup.mockInput.pressKeys(["RETURN"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.flush();
    await setup.waitForFrame((frame) => frame.includes("Items") && frame.includes("Current item"));
    setup.mockInput.pressArrow("down");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.flush();
    await setup.waitForFrame((frame) => frame.includes("COMPLETION DETAIL") && frame.includes("Navigation foundation done."));
    await key(setup, "q");
    await setup.waitForFrame((frame) => frame.includes("o:Oven catalog"));

    await key(setup, "q");
    expect(shutdowns).toBe(0);
    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await setup.flush();
    expect(shutdowns).toBe(1);
    root.unmount();
  });
});
