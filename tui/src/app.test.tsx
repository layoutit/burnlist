import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { App } from "./app";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../src/ovens/dsl/oven-compile.mjs";

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
function validCatalogDefinition(id: string) {
  const source = id === "checklist"
    ? readFileSync(new URL("../../ovens/checklist/checklist.oven", import.meta.url), "utf8")
    : `<oven id="${id}" version="0.1.0" contract="checklist-progress@1" theme="checklist"><kpi-strip title="Fixture"><kpi-item heading="Current" source="/current"/></kpi-strip></oven>`;
  const result = compileOven(source, { file: `${id}.oven` });
  if (!result.ok) throw new Error(`Catalog fixture ${id} did not compile.`);
  return { source, ir: result.ir };
}

function installApi() {
  const definition = validCatalogDefinition("checklist");
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/projects") return Response.json({ generatedAt: "now", projects: [{ repoKey: "repo1", displayName: "demo", canonicalRoot: "/demo", health: "healthy", counts: { total: 1, active: 1 } }] });
    if (path === "/api/burnlists") return Response.json({ generatedAt: "now", burnlists: [burnlist] });
    if (path === "/api/ovens") return Response.json({ ovens: [oven, { ...oven, id: "installed", name: "Installed", builtIn: false, repoKey: "repo1" }] });
    if (path === "/api/progress") return Response.json(progress);
    if (path === "/api/ovens/checklist") return Response.json({ oven: {
      ...oven, instructions: "# Checklist\n\nInspect the ordered checklist.", oven: definition.source, ovenRevision: `o1-sha256:${"a".repeat(64)}`,
      ir: definition.ir,
    } });
    return Response.json({ error: `unexpected ${path}` }, { status: 404 });
  }) as typeof fetch;
}

function installGenericRuntimeApi(missingRequired = false) {
  const genericOven = { ...oven, id: "kpi-only", name: "KPI Only" };
  const genericBurnlist = { ...burnlist, ovenId: "kpi-only", ovenName: "KPI Only" };
  const source = `<oven id="kpi-only" version="1.0.0" contract="checklist-progress@1" theme="checklist"><kpi-strip title="Executable KPI surface"><kpi-item variant="current" heading="Current" source="${missingRequired ? "/absent/value" : "/current/value"}"/><kpi-item heading="Progress"><progress-donut slot="visual" source="/progress/percent"/><progress-value done="/progress/done" total="/progress/total" percent="/progress/percent"/></kpi-item></kpi-strip></oven>`;
  const compiled = compileOven(source);
  if (!compiled.ok) throw new Error("generic runtime fixture did not compile");
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/projects") return Response.json({ generatedAt: "now", projects: [{ repoKey: "repo1", displayName: "demo", canonicalRoot: "/demo", health: "healthy", counts: { total: 1, active: 1 } }] });
    if (path === "/api/burnlists") return Response.json({ generatedAt: "now", burnlists: [genericBurnlist] });
    if (path === "/api/ovens") return Response.json({ ovens: [genericOven] });
    if (path === "/api/progress") return Response.json(progress);
    if (path === "/api/ovens/kpi-only") return Response.json({ oven: { ...genericOven, instructions: "# KPI Only", oven: source, ovenRevision: `o1-sha256:${"b".repeat(64)}`, ir: compiled.ir } });
    return Response.json({ error: `unexpected ${path}` }, { status: 404 });
  }) as typeof fetch;
}

async function key(setup: Awaited<ReturnType<typeof createTestRenderer>>, value: string) {
  setup.mockInput.pressKey(value);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await setup.flush();
}

describe("TUI navigation stack", () => {
  test("turns a render-time required binding failure into an explicit generic-runtime diagnostic", async () => {
    installGenericRuntimeApi(true);
    const setup = await createTestRenderer({ width: 110, height: 34 });
    renderers.push(setup.renderer);
    const root = createRoot(setup.renderer);
    flushSync(() => root.render(<App serverUrl="http://127.0.0.1:4510" shutdown={() => {}} />));
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist"));
    await setup.mockInput.pressKeys(["RETURN"]);
    await setup.waitForFrame((frame) => frame.includes("Missing required oven binding source") && frame.includes("/absent/value") && frame.includes("Current item"));
    expect(setup.captureCharFrame()).not.toContain("LEGACY FALLBACK");
    root.unmount();
  });

  test("routes an active Oven from App through ScreenRuntime into the generic viewport", async () => {
    installGenericRuntimeApi();
    const setup = await createTestRenderer({ width: 110, height: 34 });
    renderers.push(setup.renderer);
    const root = createRoot(setup.renderer);
    flushSync(() => root.render(<App serverUrl="http://127.0.0.1:4510" shutdown={() => {}} />));
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist"));
    await setup.mockInput.pressKeys(["RETURN"]);
    await setup.waitForFrame((frame) => frame.includes("Executable KPI surface") && frame.includes("1 · 2 (50%)") && frame.includes("› Current"));
    expect(setup.captureCharFrame()).not.toContain("LEGACY FALLBACK");
    root.unmount();
  });

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
    await setup.waitForFrame((frame) => frame.includes("COMPILED") && frame.includes("Completion") && frame.includes("enter:latest detail"));
    await key(setup, "q");
    await setup.waitForFrame((frame) => frame.includes("Oven catalog"));
    await key(setup, "q");
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist") && frame.includes("o:Oven catalog"));

    await setup.mockInput.pressKeys(["RETURN"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.flush();
    await setup.waitForFrame((frame) => frame.includes("Current item") && frame.includes("Completion 1/2"));
    expect(setup.captureCharFrame()).not.toContain("LEGACY FALLBACK");
    await key(setup, "RETURN");
    await setup.waitForFrame((frame) => frame.includes("Finish navigation.") && frame.includes("scroll detail"));
    await key(setup, "q");
    await setup.waitForFrame((frame) => frame.includes("Current item") && frame.includes("enter:item"));
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

  test("generation-owned catalog loads ignore reversed stale responses and abort on replacement/unmount", async () => {
    const first = Promise.withResolvers<Response>(), second = Promise.withResolvers<Response>();
    const summaries = [
      { ...oven, id: "first", name: "First Oven" },
      { ...oven, id: "second", name: "Second Oven" },
    ];
    const signals: AbortSignal[] = [];
    const firstDefinition = validCatalogDefinition("first"), secondDefinition = validCatalogDefinition("second");
    globalThis.fetch = ((input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/projects") return Promise.resolve(Response.json({ generatedAt: "now", projects: [] }));
      if (path === "/api/burnlists") return Promise.resolve(Response.json({ generatedAt: "now", burnlists: [] }));
      if (path === "/api/ovens") return Promise.resolve(Response.json({ ovens: summaries }));
      if (path === "/api/ovens/first" || path === "/api/ovens/second") {
        signals.push(init?.signal as AbortSignal);
        return path.endsWith("first") ? first.promise : second.promise;
      }
      return Promise.resolve(Response.json({ error: "unexpected" }, { status: 404 }));
    }) as typeof fetch;
    const setup = await createTestRenderer({ width: 110, height: 34 });
    renderers.push(setup.renderer);
    const root = createRoot(setup.renderer);
    flushSync(() => root.render(<App serverUrl="http://127.0.0.1:4510" shutdown={() => {}} />));
    await setup.waitForFrame((frame) => frame.includes("o:Oven catalog"));
    await key(setup, "o"); await setup.waitForFrame((frame) => frame.includes("First Oven") && frame.includes("Second Oven"));
    await setup.mockInput.pressKeys(["RETURN"]); await new Promise((resolve) => setTimeout(resolve, 0)); await setup.flush();
    await setup.waitForFrame((frame) => frame.includes("First Oven") && frame.includes("GENERIC"));
    await key(setup, "q"); await setup.waitForFrame((frame) => frame.includes("Oven catalog"));
    setup.mockInput.pressArrow("down"); await new Promise((resolve) => setTimeout(resolve, 0)); await setup.flush();
    await setup.mockInput.pressKeys(["RETURN"]); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signals[0]?.aborted).toBe(true);
    second.resolve(Response.json({ oven: { ...summaries[1], description: "Second resolved description", instructions: "# Second\n\nLatest response.", oven: secondDefinition.source, ovenRevision: `o1-sha256:${"b".repeat(64)}`, ir: secondDefinition.ir } }));
    await setup.waitForFrame((frame) => frame.includes("Second resolved description"));
    first.resolve(Response.json({ oven: { ...summaries[0], description: "Stale first description", instructions: "# First\n\nStale response.", oven: firstDefinition.source, ovenRevision: `o1-sha256:${"c".repeat(64)}`, ir: firstDefinition.ir } }));
    await new Promise((resolve) => setTimeout(resolve, 0)); await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Stale first description");
    flushSync(() => root.unmount()); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signals[1]?.aborted).toBe(true);
  });

  test("generation-owned Burnlist lens loads keep the latest IR and payload under reversed responses", async () => {
    const firstData = Promise.withResolvers<Response>(), firstDetail = Promise.withResolvers<Response>(), secondData = Promise.withResolvers<Response>(), secondDetail = Promise.withResolvers<Response>();
    const lensOvens = [
      { ...oven, id: "first-lens", name: "First Lens", contract: "burnlist-visual-parity-data@1", dataInput: "json-payload" },
      { ...oven, id: "second-lens", name: "Second Lens", contract: "burnlist-visual-parity-data@1", dataInput: "json-payload" },
    ];
    const lensBurnlist = { ...burnlist, ovenId: "first-lens", ovenName: "First Lens", planPath: null };
    const source = `<oven id="lens-kpi" version="1.0.0" contract="burnlist-visual-parity-data@1" theme="visual-parity"><kpi-strip title="Lens runtime"><kpi-item heading="Payload" source="/current"/></kpi-strip></oven>`;
    const ir = compileOven(source); if (!ir.ok) throw new Error("lens fixture did not compile");
    const signals: AbortSignal[] = [], paths: string[] = [];
    globalThis.fetch = ((input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/projects") return Promise.resolve(Response.json({ generatedAt: "now", projects: [] }));
      if (path === "/api/burnlists") return Promise.resolve(Response.json({ generatedAt: "now", burnlists: [lensBurnlist] }));
      if (path === "/api/ovens") return Promise.resolve(Response.json({ ovens: lensOvens }));
      const pending = path === "/api/oven-data/first-lens" ? firstData : path === "/api/ovens/first-lens" ? firstDetail : path === "/api/oven-data/second-lens" ? secondData : path === "/api/ovens/second-lens" ? secondDetail : null;
      if (pending) { signals.push(init?.signal as AbortSignal); paths.push(path); return pending.promise; }
      return Promise.resolve(Response.json({ error: "unexpected" }, { status: 404 }));
    }) as typeof fetch;
    const setup = await createTestRenderer({ width: 110, height: 34 }); renderers.push(setup.renderer);
    const root = createRoot(setup.renderer);
    flushSync(() => root.render(<App serverUrl="http://127.0.0.1:4510" shutdown={() => {}} />));
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist"));
    await setup.mockInput.pressKeys(["RETURN"]); await new Promise((resolve) => setTimeout(resolve, 0)); await setup.flush();
    await key(setup, "]");
    expect(paths).toEqual(["/api/oven-data/first-lens", "/api/ovens/first-lens", "/api/oven-data/second-lens", "/api/ovens/second-lens"]);
    expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
    expect(signals.slice(2).every((signal) => !signal.aborted)).toBe(true);
    secondData.resolve(Response.json({ ovenId: "second-lens", payload: { current: "Second payload" }, validated: true }));
    secondDetail.resolve(Response.json({ oven: { ...lensOvens[1], instructions: "# Lens", oven: source, ovenRevision: `o1-sha256:${"b".repeat(64)}`, ir: { ...ir.ir, id: "second-lens" } } }));
    await new Promise((resolve) => setTimeout(resolve, 0)); await setup.flush();
    await setup.waitForFrame((frame) => frame.includes("Lens runtime") && frame.includes("Second payload"));
    firstData.resolve(Response.json({ ovenId: "first-lens", payload: { current: "Stale first payload" }, validated: true }));
    firstDetail.resolve(Response.json({ oven: { ...lensOvens[0], instructions: "# Lens", oven: source, ovenRevision: `o1-sha256:${"c".repeat(64)}`, ir: { ...ir.ir, id: "first-lens" } } }));
    await new Promise((resolve) => setTimeout(resolve, 0)); await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Stale first payload");
    root.unmount();
  });

  test("drives compiled server-paged Oven controls into bounded canonical App requests", async () => {
    const source = readFileSync(new URL("../../ovens/differential-testing/differential-testing.oven", import.meta.url), "utf8");
    const compiled = compileOven(source); if (!compiled.ok) throw new Error("paged fixture did not compile");
    const pagedOven = { ...oven, id: "differential-testing", name: "Differential", contract: "burnlist-differential-testing-data@1", dataInput: "json-payload" };
    const pagedBurnlist = { ...burnlist, ovenId: pagedOven.id, ovenName: pagedOven.name, planPath: null };
    const requests: string[] = [];
    const payload = { pageMode: "detail", telemetry: { status: "comparable", fields: {} }, fields: [], progress: {}, log: [], refresh: {}, __burnlistOvenRuntime: { collectionPages: { "/fields": { page: 0, pageSize: 25, pageCount: 4, total: 80 } } } };
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input)), path = url.pathname;
      if (path === "/api/projects") return Response.json({ generatedAt: "now", projects: [] });
      if (path === "/api/burnlists") return Response.json({ generatedAt: "now", burnlists: [pagedBurnlist] });
      if (path === "/api/ovens") return Response.json({ ovens: [pagedOven] });
      if (path === "/api/ovens/differential-testing") return Response.json({ oven: { ...pagedOven, repoKey: null, instructions: "# Differential", oven: source, ovenRevision: `o1-sha256:${"d".repeat(64)}`, ir: compiled.ir } });
      if (path === "/api/oven-data/differential-testing") { requests.push(url.search); const page = Number(url.searchParams.get("page") ?? 0), pageSize = Number(url.searchParams.get("pageSize") ?? 25); return Response.json({ ovenId: pagedOven.id, payload: { ...payload, __burnlistOvenRuntime: { collectionPages: { "/fields": { page, pageSize, pageCount: 4, total: 80 } } } }, validated: true }); }
      return Response.json({ error: "unexpected" }, { status: 404 });
    }) as typeof fetch;
    const setup = await createTestRenderer({ width: 110, height: 34 }); renderers.push(setup.renderer);
    const root = createRoot(setup.renderer); flushSync(() => root.render(<App serverUrl="http://127.0.0.1:4510" shutdown={() => {}} />));
    await setup.waitForFrame((frame) => frame.includes("Demo Burnlist")); await key(setup, "RETURN");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const beforeTyping = requests.length;
    await key(setup, "x"); await key(setup, "q"); await new Promise((resolve) => setTimeout(resolve, 60));
    expect(requests.length).toBe(beforeTyping);
    await key(setup, "ESCAPE"); await new Promise((resolve) => setTimeout(resolve, 180));
    expect(requests.length).toBe(beforeTyping);
    await key(setup, "x"); await key(setup, "q"); await key(setup, "r"); await key(setup, "o"); await key(setup, "ESCAPE"); await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests.length).toBe(beforeTyping);
    await key(setup, "x"); await key(setup, "q"); await key(setup, "r"); await key(setup, "o"); await key(setup, "BACKSPACE"); await key(setup, "a"); await key(setup, "RETURN"); await key(setup, "f"); await key(setup, "s"); await key(setup, "m"); await key(setup, "n"); await new Promise((resolve) => setTimeout(resolve, 30)); await key(setup, "z"); await new Promise((resolve) => setTimeout(resolve, 30)); await key(setup, "z");
    await new Promise((resolve) => setTimeout(resolve, 80)); await setup.flush();
    const last = new URLSearchParams(requests.at(-1));
    expect(requests.length).toBeLessThan(12);
    expect(last.get("search")).toBe("qra"); expect(last.get("filter")).toBeTruthy(); expect(last.get("sort")).toBeTruthy(); expect(last.get("page")).toBe("0"); expect(last.get("pageSize")).toBeTruthy();
    root.unmount();
  });
});
