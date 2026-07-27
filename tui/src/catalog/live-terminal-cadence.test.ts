import { describe, expect, test } from "bun:test";
import { subscribeLiveTerminalCadence, type IntervalClock } from "./live-terminal-cadence";

describe("live Storybook terminal cadence", () => {
  test("fake timer advances the real shared cadence", () => {
    let callback: (() => void) | undefined, cleared = 0;
    const clock: IntervalClock = {
      setInterval(next) { callback = next; return 7; },
      clearInterval() { cleared += 1; },
    };
    const phases: number[] = [], dispose = subscribeLiveTerminalCadence((phase) => phases.push(phase), false, clock);
    callback?.();
    callback?.();
    expect(phases).toEqual([0, 1, 2]);
    dispose();
    expect(cleared).toBe(1);
  });

  test("reduced motion freezes at the shared rest frame and installs no timer", () => {
    let installed = 0;
    const clock: IntervalClock = {
      setInterval() { installed += 1; return 1; },
      clearInterval() {},
    };
    const phases: number[] = [];
    subscribeLiveTerminalCadence((phase) => phases.push(phase), true, clock)();
    expect(phases).toEqual([4]);
    expect(installed).toBe(0);
  });
});
