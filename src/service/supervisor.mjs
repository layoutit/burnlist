import { randomBytes } from "node:crypto";
import { spawn as spawnChild } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ownedGlobalInstall, readJson, servicePaths } from "./runtime.mjs";

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const identity = () => randomBytes(18).toString("hex");

export function explicitServer(args) {
  const index = args.indexOf("--server");
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--server requires a URL.");
  return value;
}

export async function probeRuntime(runtime, { fetchImpl = globalThis.fetch, timeoutMs = 800 } = {}) {
  if (!runtime || typeof runtime.url !== "string" || typeof runtime.instanceId !== "string") return null;
  let url;
  try {
    url = new URL("/api/health", runtime.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return null;
  } catch { return null; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    const health = await response.json();
    return health?.schema === "burnlist-service@1"
      && health.instanceId === runtime.instanceId
      && health.version === runtime.version ? { runtime, health } : null;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

async function waitForRuntime(path, instanceId, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 8_000);
  while (Date.now() < deadline) {
    const runtime = readJson(path);
    if (runtime?.instanceId === instanceId && await probeRuntime(runtime, options)) return runtime;
    await delay(50);
  }
  throw new Error("Burnlist server did not become ready.");
}

function serverCommand(packageRoot, stateDir) {
  return [
    resolve(packageRoot, "src/server/burnlist-dashboard-server.mjs"),
    "--port", "0",
    "--auto-port",
    "--state-dir", stateDir,
  ];
}

function spawnServer({ packageRoot, cwd, stateDir, scope, instanceId, token, detached, spawn = spawnChild, env = process.env }) {
  const child = spawn(process.execPath, serverCommand(packageRoot, stateDir), {
    cwd,
    env: {
      ...env,
      BURNLIST_SERVICE_SCOPE: scope,
      BURNLIST_SERVICE_INSTANCE: instanceId,
      BURNLIST_SERVICE_TOKEN: token,
    },
    detached,
    stdio: "ignore",
  });
  child.unref?.();
  return child;
}

async function withServiceLock(path, operation, { timeoutMs = 8_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  mkdirSync(resolve(path, ".."), { recursive: true });
  while (true) {
    try { mkdirSync(path); break; }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > 60_000) {
          rmSync(path, { recursive: true, force: true });
          continue;
        }
      } catch (inspectionError) {
        if (inspectionError?.code !== "ENOENT") throw inspectionError;
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the Burnlist service lock.");
      await delay(50);
    }
  }
  try { return await operation(); }
  finally { rmSync(path, { recursive: true, force: true }); }
}

export async function stopRuntime(runtime, { fetchImpl = globalThis.fetch } = {}) {
  if (!runtime?.token || !await probeRuntime(runtime, { fetchImpl })) return false;
  try {
    const response = await fetchImpl(new URL("/api/service/shutdown", runtime.url), {
      method: "POST",
      headers: { "x-burnlist-service-token": runtime.token },
    });
    if (!response.ok) return false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!await probeRuntime(runtime, { fetchImpl, timeoutMs: 100 })) return true;
      await delay(25);
    }
    return false;
  } catch { return false; }
}

export async function ensureSharedService({ packageRoot, version, cwd = process.cwd(), env = process.env, spawn, fetchImpl } = {}) {
  const paths = servicePaths(env);
  return withServiceLock(paths.lock, async () => {
    const current = readJson(paths.runtime);
    const live = await probeRuntime(current, { fetchImpl });
    if (live && current.version === version && current.scope === "shared") return current;
    if (live) {
      if (!await stopRuntime(current, { fetchImpl })) throw new Error("A different live Burnlist server owns the global runtime.");
      await delay(75);
    }
    const instanceId = identity(), token = identity();
    const stateDir = join(paths.home, "service-state");
    spawnServer({ packageRoot, cwd, stateDir, scope: "shared", instanceId, token, detached: true, spawn, env });
    return waitForRuntime(paths.runtime, instanceId, { fetchImpl });
  });
}

export async function startEphemeralService({ packageRoot, cwd = process.cwd(), env = process.env, spawn, fetchImpl } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "burnlist-tui-"));
  const stateDir = join(temporary, "state");
  const instanceId = identity(), token = identity();
  const child = spawnServer({ packageRoot, cwd, stateDir, scope: "ephemeral", instanceId, token, detached: false, spawn, env });
  try {
    const runtime = await waitForRuntime(join(stateDir, "index.server.json"), instanceId, { fetchImpl });
    return {
      runtime,
      async stop() {
        await stopRuntime(runtime, { fetchImpl });
        if (child && child.exitCode === null) child.kill?.("SIGTERM");
        rmSync(temporary, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child && child.exitCode === null) child.kill?.("SIGTERM");
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function resolveInteractiveService({ args, packageRoot, version, cwd, env = process.env, ...options }) {
  const specified = explicitServer(args);
  if (specified) return { url: specified, stop: async () => {} };
  const forceLocal = args.includes("--local");
  if (!forceLocal && ownedGlobalInstall(packageRoot, version, { env })) {
    const runtime = await ensureSharedService({ packageRoot, version, cwd, env, ...options });
    return { url: runtime.url, stop: async () => {} };
  }
  const ephemeral = await startEphemeralService({ packageRoot, cwd, env, ...options });
  return { url: ephemeral.runtime.url, stop: ephemeral.stop };
}

export async function serviceStatus({ env = process.env, fetchImpl } = {}) {
  const runtime = readJson(servicePaths(env).runtime);
  return await probeRuntime(runtime, { fetchImpl }) ? { running: true, runtime } : { running: false, runtime };
}
