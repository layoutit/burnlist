import {
  TERMINAL_LOADING_FPS,
  TERMINAL_LOADING_FRAMES,
  TERMINAL_LOADING_REST_PHASE,
} from "../loading-cadence";

export type IntervalClock = {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
};

/** Injectable cadence authority shared by the browser adapter and fake-timer tests. */
export function subscribeLiveTerminalCadence(
  onPhase: (phase: number) => void,
  reducedMotion: boolean,
  clock: IntervalClock = globalThis,
): () => void {
  if (reducedMotion) {
    onPhase(TERMINAL_LOADING_REST_PHASE);
    return () => {};
  }
  let phase = 0;
  onPhase(phase);
  const timer = clock.setInterval(() => {
    phase = (phase + 1) % TERMINAL_LOADING_FRAMES.length;
    onPhase(phase);
  }, 1000 / TERMINAL_LOADING_FPS);
  return () => clock.clearInterval(timer);
}
