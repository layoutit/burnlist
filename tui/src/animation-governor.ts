import { useEffect, useRef } from "react";
import { TERMINAL_RESOURCE_LIMITS } from "./oven-runtime/resource-limits";

type Subscriber = Readonly<{ callback(): void; intervalMs: number; lastRun: number }>;

const subscribers = new Map<symbol, Subscriber>();
let timer: ReturnType<typeof setInterval> | null = null;

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function tick(now = performance.now()): void {
  for (const [id, subscriber] of subscribers) {
    if (now - subscriber.lastRun < subscriber.intervalMs) continue;
    subscribers.set(id, { ...subscriber, lastRun: now });
    subscriber.callback();
  }
}

function ensureTimer(): void {
  if (timer || subscribers.size === 0) return;
  timer = setInterval(() => tick(), 1000 / TERMINAL_RESOURCE_LIMITS.animationFps);
  timer.unref?.();
}

/** Shares one bounded timer across terminal animations and disposes it at zero subscribers. */
export function subscribeTerminalAnimation(callback: () => void, fps: number): () => void {
  if (subscribers.size >= TERMINAL_RESOURCE_LIMITS.animations) return () => {};
  const id = Symbol("terminal-animation");
  const boundedFps = Math.min(TERMINAL_RESOURCE_LIMITS.animationFps, Math.max(1, Number.isFinite(fps) ? fps : 1));
  subscribers.set(id, { callback, intervalMs: 1000 / boundedFps, lastRun: performance.now() });
  ensureTimer();
  return () => {
    subscribers.delete(id);
    if (subscribers.size === 0) stopTimer();
  };
}

export function terminalAnimationResources(): Readonly<{ subscribers: number; timers: number }> {
  return { subscribers: subscribers.size, timers: timer ? 1 : 0 };
}

export function useTerminalAnimation(callback: () => void, fps: number, enabled = true): void {
  const current = useRef(callback);
  current.current = callback;
  useEffect(() => enabled ? subscribeTerminalAnimation(() => current.current(), fps) : undefined, [enabled, fps]);
}
