import { afterEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { controlsAction, controlsCheckpoint, controlsFixture, controlsInitialState, controlsPage, controlsRows, type ControlsState } from "./controls-fixture";
import { ControlsSurface, InteractiveControlsSurface } from "./controls-surface";

const renderers: Array<{ destroy(): void }> = [];
afterEach(() => { while (renderers.length) renderers.pop()?.destroy(); });
async function press(setup: Awaited<ReturnType<typeof createTestRenderer>>, key: string) {
  setup.mockInput.pressKey(key);
  await new Promise((resolve) => setTimeout(resolve, 8));
  await setup.flush();
}

test("control action trace changes tabs, search, filter and bounded pagination", () => {
  let state = controlsInitialState();
  state = controlsAction(state, "right"); expect(state.tab).toBe(1);
  state = controlsAction(state, "tab"); state = controlsAction(state, "p"); state = controlsAction(state, "o"); expect(controlsRows(state)).toHaveLength(1);
  state = controlsAction(state, "backspace"); expect(state.query).toBe("p");
  state = controlsAction(state, "tab"); state = controlsAction(state, "return"); expect(state.filter).toBe(true);
  state = { ...controlsInitialState(), focus: "next" }; state = controlsAction(state, "return"); expect(controlsPage(state).page).toBe(1);
  state = controlsAction(state, "return"); expect(state.notice).toContain("last page");
});

test("unavailable sort is explicit and cannot mutate fixture state", () => {
  const before: ControlsState = { ...controlsInitialState(), focus: "sort" }, after = controlsAction(before, "return");
  expect(after).toMatchObject({ tab: before.tab, query: before.query, filter: before.filter, page: before.page });
  expect(after.notice).toContain("unavailable");
});

test("one shared fixture defines checkpoints and footer-safe pagination data", () => {
  expect(controlsFixture.checkpoints).toEqual(["initial", "searched", "filtered", "next-page"]);
  expect(controlsCheckpoint("searched").query).toBe("pos");
  expect(controlsPage(controlsCheckpoint("next-page"))).toMatchObject({ page: 1, count: 2 });
});

test("real wide and narrow frames stay bounded with a reserved footer", async () => {
  for (const width of [36, 72]) {
    for (const checkpoint of controlsFixture.checkpoints) {
      const setup = await createTestRenderer({ width, height: 12, useThread: false }); renderers.push(setup.renderer);
      const root = createRoot(setup.renderer);
      flushSync(() => root.render(<ControlsSurface state={controlsCheckpoint(checkpoint)} />));
      await setup.renderOnce();
      const lines = setup.captureCharFrame().split("\n");
      expect(lines.every((line) => Array.from(line).length <= width)).toBe(true);
      expect(lines.slice(-2).join("\n")).toContain("q:back");
      expect(lines.slice(0, -2).join("\n")).toContain("Prev");
      expect(lines.slice(0, -2).join("\n")).toContain("Next");
      expect(lines.slice(0, -2).join("\n")).toContain("Fields");
      root.unmount(); setup.renderer.destroy(); renderers.pop();
    }
  }
});

test("real keyboard surface exposes search, filter, paging, view, and q-back", async () => {
  const setup = await createTestRenderer({ width: 72, height: 14, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); let backs = 0, views = 0;
  flushSync(() => root.render(<InteractiveControlsSurface onBack={() => { backs += 1; }} onView={() => { views += 1; }} />));
  await setup.waitForFrame((frame) => frame.includes("● Fields !1"));
  await press(setup, "TAB"); await press(setup, "p"); await press(setup, "o");
  await setup.waitForFrame((frame) => frame.includes("Search: po") && frame.includes("Position"));
  await press(setup, "TAB"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("[x] Failed"));
  await press(setup, "TAB"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Sort unavailable"));
  await press(setup, "v"); expect(views).toBe(1);
  await press(setup, "q"); expect(backs).toBe(1);
  root.unmount();
});
