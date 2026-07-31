import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureAgentMonitorFeedRoot } from "../../ovens/agent-monitor/engine/agent-monitor-feed.mjs";

export const AGENT_MONITOR_LEASE_MS = 30_000;
export const AGENT_MONITOR_REFRESH_MS = 2_000;
const agentMonitorCli = fileURLToPath(new URL("../../bin/burnlist.mjs", import.meta.url));

/** Keep transcript discovery off the dashboard event loop. */
export function runAgentMonitorChild({ repoRoot, signal, spawnChild = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, [
      agentMonitorCli, "agent-monitor", "run", "--repo", repoRoot,
    ], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    let aborted = false;
    child.once("error", () => reject(new Error("Agent Monitor refresh could not start.")));
    child.once("exit", (code, childSignal) => {
      if (code === 0 || (aborted && childSignal === "SIGTERM")) resolve();
      else reject(new Error("Agent Monitor refresh failed."));
    });
    signal?.addEventListener("abort", () => {
      aborted = true;
      child.kill("SIGTERM");
    }, { once: true });
  });
}

/** Service-owned, renewable observation leases. Opening a view starts work; closing it lets work expire. */
export function createAgentMonitorLeaseManager({
  clearTimer = clearTimeout,
  leaseMs = AGENT_MONITOR_LEASE_MS,
  now = Date.now,
  prepare = ensureAgentMonitorFeedRoot,
  refreshMs = AGENT_MONITOR_REFRESH_MS,
  run = runAgentMonitorChild,
  setTimer = setTimeout,
} = {}) {
  const leases = new Map();
  const observed = new Set();
  const health = new Map();
  let stopped = false;
  let timer = null;
  let running = false;
  let activeRun = null;
  let cursor = 0;

  function schedule(delay = refreshMs) {
    if (stopped || timer !== null) return;
    timer = setTimer(cycle, delay);
    timer?.unref?.();
  }

  function activeRoots(at = now()) {
    for (const [root, expiresAt] of leases) {
      if (expiresAt <= at) {
        leases.delete(root);
        observed.delete(root);
      }
    }
    return [...leases.keys()];
  }

  function cycle() {
    timer = null;
    if (stopped || running) return;
    const roots = activeRoots();
    if (!roots.length) return;
    running = true;
    const controller = new AbortController();
    activeRun = controller;
    const complete = (error = null) => {
      if (activeRun === controller) activeRun = null;
      if (error) {
        health.set(repoRoot, {
          error: "Agent Monitor refresh failed.",
          failedAt: new Date(now()).toISOString(),
          lastSuccessAt: health.get(repoRoot)?.lastSuccessAt ?? null,
        });
      } else {
        health.set(repoRoot, {
          error: null,
          failedAt: null,
          lastSuccessAt: new Date(now()).toISOString(),
        });
        observed.add(repoRoot);
      }
      running = false;
      if (activeRoots().length) schedule();
    };
    const repoRoot = roots[cursor % roots.length];
    cursor += 1;
    try {
      const result = run({ repoRoot, signal: controller.signal });
      if (result && typeof result.then === "function") {
        result.then(() => complete(), (error) => complete(error));
        return;
      }
    } catch (error) {
      complete(error);
      return;
    }
    complete();
  }

  return Object.freeze({
    activate(repoRoot) {
      if (stopped) throw new Error("Agent Monitor lease manager is stopped.");
      const prepared = prepare(repoRoot);
      const root = prepared?.logicalRepoRoot ?? repoRoot;
      const expiresAt = now() + leaseMs;
      leases.set(root, expiresAt);
      if (!observed.has(root)) {
        if (timer !== null) clearTimer(timer);
        timer = null;
        schedule(0);
      } else {
        schedule();
      }
      return {
        active: true,
        expiresAt: new Date(expiresAt).toISOString(),
        repoRoot: root,
        observer: health.get(root) ?? {
          error: null,
          failedAt: null,
          lastSuccessAt: null,
        },
      };
    },
    status() {
      return {
        activeRoots: activeRoots(),
        running,
        observers: Object.fromEntries([...health]),
      };
    },
    stop() {
      stopped = true;
      leases.clear();
      observed.clear();
      health.clear();
      activeRun?.abort();
      activeRun = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  });
}
