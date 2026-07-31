#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MACOS_BUNDLED_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";
const CONNECT_TIMEOUT_MS = 10_000;
const SOCKET_PROBE_MS = 2_000;
const STARTUP_LOCK_STALE_MS = 30_000;

export function defaultBridgeSocket(env = process.env, home = os.homedir()) {
  return env.BURNLIST_CODEX_APP_SERVER_SOCKET?.trim()
    || join(home, ".codex", "burnlist-app-server", "app-server.sock");
}

export function realCodexBinary(env = process.env, platform = process.platform) {
  if (env.BURNLIST_CODEX_BIN?.trim()) return env.BURNLIST_CODEX_BIN.trim();
  if (platform === "darwin" && existsSync(MACOS_BUNDLED_CODEX)) return MACOS_BUNDLED_CODEX;
  return "codex";
}

export function bridgeLaunchArgs(args, socket) {
  const appServer = args.indexOf("app-server");
  if (appServer < 0) return null;
  const common = args.slice(0, appServer);
  const serverOptions = [];
  const input = args.slice(appServer + 1);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === "--stdio") continue;
    if (value === "--listen") {
      index += 1;
      continue;
    }
    if (value.startsWith("--listen=")) continue;
    serverOptions.push(value);
  }
  return {
    proxy: [...common, "app-server", "proxy", "--sock", socket],
    server: [...common, "app-server", ...serverOptions, "--listen", `unix://${socket}`],
  };
}

function socketConnection(path, timeoutMs = SOCKET_PROBE_MS) {
  return new Promise((resolveConnection) => {
    const socket = connect(path);
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnection(result);
    };
    socket.once("connect", () => done({ connected: true, code: null, timedOut: false }));
    socket.once("error", (error) => done({
      connected: false,
      code: error?.code ?? null,
      timedOut: false,
    }));
    socket.setTimeout(timeoutMs, () => done({ connected: false, code: null, timedOut: true }));
  });
}

async function waitForSocket(path, child, timeoutMs = CONNECT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Shared Codex App Server exited with code ${child.exitCode}.`);
    }
    if ((await socketConnection(path)).connected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Shared Codex App Server did not open ${path}.`);
}

async function staleSocket(path) {
  if (!existsSync(path)) return;
  const entry = lstatSync(path);
  if (!entry.isSocket()) {
    throw new Error(`Refusing to replace non-socket bridge path: ${path}`);
  }
  const probe = await socketConnection(path);
  if (probe.connected) return false;
  if (probe.timedOut || !["ECONNREFUSED", "ENOENT"].includes(probe.code)) {
    throw new Error(`Refusing to replace an unresponsive bridge socket: ${path}`);
  }
  rmSync(path, { force: true });
  return true;
}

function lockOwnerIsDead(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!Number.isSafeInteger(value?.pid) || value.pid < 1) return false;
    process.kill(value.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function acquireStartupLock(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    closeSync(descriptor);
    return true;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function startupLock(path, socket) {
  if (acquireStartupLock(path)) return true;
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await socketConnection(socket)).connected) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const old = Date.now() - statSync(path).mtimeMs >= STARTUP_LOCK_STALE_MS;
  if (!old || !lockOwnerIsDead(path)) {
    throw new Error(`Shared Codex App Server startup is already in progress: ${path}`);
  }
  rmSync(path, { force: true });
  if (!acquireStartupLock(path)) {
    throw new Error(`Could not acquire shared Codex App Server startup lock: ${path}`);
  }
  return true;
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(
      Number.isInteger(code) ? code : signal ? 1 : 0,
    ));
  });
}

export async function runCodexBridge({
  args = process.argv.slice(2),
  env = process.env,
  spawnProcess = spawn,
} = {}) {
  const binary = realCodexBinary(env);
  const socket = defaultBridgeSocket(env);
  const socketDirectory = dirname(socket);
  const lockPath = `${socket}.startup`;
  const launch = bridgeLaunchArgs(args, socket);
  if (!launch) {
    const delegated = spawnProcess(binary, args, { env, shell: false, stdio: "inherit" });
    return waitForExit(delegated);
  }
  mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
  if (!env.BURNLIST_CODEX_APP_SERVER_SOCKET?.trim()) chmodSync(socketDirectory, 0o700);
  let server = null;
  let ownsLock = false;
  if (!(await socketConnection(socket)).connected) {
    ownsLock = await startupLock(lockPath, socket);
    try {
      if (!(await socketConnection(socket)).connected) {
        await staleSocket(socket);
        server = spawnProcess(binary, launch.server, {
          env,
          shell: false,
          stdio: ["ignore", "ignore", "inherit"],
        });
        await waitForSocket(socket, server);
      }
      chmodSync(socket, 0o600);
    } catch (error) {
      if (server?.exitCode === null) server.kill("SIGTERM");
      throw error;
    } finally {
      if (ownsLock) rmSync(lockPath, { force: true });
    }
  } else {
    chmodSync(socket, 0o600);
  }
  const proxy = spawnProcess(binary, launch.proxy, { env, shell: false, stdio: "inherit" });
  const forward = (signal) => {
    if (proxy.exitCode === null) proxy.kill(signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    return await waitForExit(proxy);
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
    if (server?.exitCode === null) server.kill("SIGTERM");
  }
}

async function main() {
  if (process.argv.includes("--bridge-help")) {
    console.log(`Use this executable as CODEX_CLI_PATH to give Codex Desktop and Burnlist
one shared App Server. The default socket is:

  ${defaultBridgeSocket()}

Override the real Codex binary with BURNLIST_CODEX_BIN and the socket with
BURNLIST_CODEX_APP_SERVER_SOCKET.`);
    return;
  }
  process.exitCode = await runCodexBridge();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
