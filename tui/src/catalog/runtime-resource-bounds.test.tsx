import { describe, expect, test } from "bun:test";
import { subscribeTerminalAnimation, terminalAnimationResources } from "../animation-governor";
import { TERMINAL_RESOURCE_LIMITS } from "../oven-runtime/resource-limits";
import { createLatestValueScheduler } from "../use-coalesced-terminal-dimensions";
import "./runtime-resource-admission.test";
import "./runtime-resource-streams.test";
import "../runtime-resource-media.test";

describe("terminal runtime resource bounds", () => {
  test("publishes finite deterministic allocation ceilings", () => {
    for (const value of Object.values(TERMINAL_RESOURCE_LIMITS)) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(TERMINAL_RESOURCE_LIMITS.imageCells).toBeLessThanOrEqual(TERMINAL_RESOURCE_LIMITS.terminalCells);
    expect(TERMINAL_RESOURCE_LIMITS.pngCompressedBytes).toBeLessThanOrEqual(TERMINAL_RESOURCE_LIMITS.httpJsonBytes);
    expect(TERMINAL_RESOURCE_LIMITS.animationFps).toBeLessThanOrEqual(20);
  });

  test("admits one shared animation timer and returns to baseline on disposal", () => {
    expect(terminalAnimationResources()).toEqual({ subscribers: 0, timers: 0 });
    const first = subscribeTerminalAnimation(() => {}, 120);
    const second = subscribeTerminalAnimation(() => {}, 120);
    expect(terminalAnimationResources()).toEqual({ subscribers: 1, timers: 1 });
    second();
    expect(terminalAnimationResources()).toEqual({ subscribers: 1, timers: 1 });
    first();
    expect(terminalAnimationResources()).toEqual({ subscribers: 0, timers: 0 });
  });

  test("coalesces resize storms to the latest value and cancels pending work", () => {
    const callbacks: Array<() => void> = [], committed: number[] = [];
    const scheduler = createLatestValueScheduler<number>((value) => committed.push(value), (callback) => { callbacks.push(callback); return callback; }, (handle) => callbacks.splice(callbacks.indexOf(handle as () => void), 1));
    for (let value = 0; value < 1_000; value += 1) scheduler.push(value);
    expect(scheduler.resources()).toEqual({ pending: 1, disposed: false });
    callbacks.shift()?.();
    expect(committed).toEqual([999]);
    scheduler.push(1_000);
    scheduler.dispose();
    callbacks.shift()?.();
    expect(committed).toEqual([999]);
    expect(scheduler.resources()).toEqual({ pending: 0, disposed: true });
  });
});
