import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";

export type TerminalDimensions = Readonly<{ width: number; height: number }>;
type Schedule = (callback: () => void) => unknown;
type Cancel = (handle: unknown) => void;

export function createLatestValueScheduler<T>(
  commit: (value: T) => void,
  schedule: Schedule = (callback) => setTimeout(callback, 0),
  cancel: Cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
) {
  let latest: T | undefined, pending: unknown | null = null, disposed = false;
  return Object.freeze({
    push(value: T) {
      if (disposed) return;
      latest = value;
      if (pending !== null) return;
      pending = schedule(() => {
        pending = null;
        if (!disposed && latest !== undefined) commit(latest);
      });
    },
    dispose() {
      disposed = true;
      if (pending !== null) cancel(pending);
      pending = null;
      latest = undefined;
    },
    resources: () => ({ pending: pending === null ? 0 : 1, disposed }),
  });
}

/** Commits only the latest resize observed in a burst and cancels pending work on unmount. */
export function useCoalescedTerminalDimensions(): TerminalDimensions {
  const live = useTerminalDimensions();
  const [dimensions, setDimensions] = useState<TerminalDimensions>(live);
  const scheduler = useRef<ReturnType<typeof createLatestValueScheduler<TerminalDimensions>> | null>(null);
  if (!scheduler.current) scheduler.current = createLatestValueScheduler(setDimensions);
  useEffect(() => scheduler.current!.push(live), [live.height, live.width]);
  useEffect(() => () => scheduler.current?.dispose(), []);
  return dimensions;
}
