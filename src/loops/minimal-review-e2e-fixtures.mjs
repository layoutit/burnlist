import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "burnlist.mjs");
const server = join(root, "src", "server", "burnlist-dashboard-server.mjs");

export function cliJson(repo, args, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args, "--repo", repo], {
    cwd: repo, encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr || result.stdout}`);
  assert.equal(result.stderr, "", args.join(" "));
  return JSON.parse(result.stdout);
}

export function cliOk(repo, args, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args, "--repo", repo], {
    cwd: repo, encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr || result.stdout}`);
  assert.equal(result.stderr, "", args.join(" "));
  return result.stdout;
}

export function startCli(repo, args, env = {}) {
  return spawn(process.execPath, [cli, ...args, "--repo", repo], {
    cwd: repo, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function waitForExit(child) {
  const chunks = [[], []];
  child.stdout.on("data", (value) => chunks[0].push(value));
  child.stderr.on("data", (value) => chunks[1].push(value));
  const [code, signal] = await new Promise((done) => child.once("exit", (...value) => done(value)));
  return { code, signal, stdout: Buffer.concat(chunks[0]).toString("utf8"), stderr: Buffer.concat(chunks[1]).toString("utf8") };
}

export async function waitForFile(path, child, timeout = 5_000) {
  const until = Date.now() + timeout;
  while (!existsSync(path)) {
    if (child.exitCode !== null) throw new Error(`foreground CLI exited before ${path}`);
    if (Date.now() >= until) throw new Error(`timed out waiting for ${path}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForServer(child) {
  let output = "";
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`dashboard did not start: ${output}`)), 8_000);
    const ready = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
      if (!match) return;
      clearTimeout(timeout); resolveReady(match[0]);
    };
    child.stdout.on("data", ready); child.stderr.on("data", ready);
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`dashboard exited ${code}: ${output}`)); });
  });
}

export async function withDashboard(repo, action) {
  const port = await availablePort();
  const child = spawn(process.execPath, [server, "--port", String(port), "--auto-port", "--scan-root", repo,
    "--state-dir", join(repo, ".local", "m9-dashboard")], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  try { return await action(await waitForServer(child)); }
  finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((done) => child.once("exit", done));
  }
}

export function request(baseUrl, path, { headers = {} } = {}) {
  return fetch(new URL(path, baseUrl), { headers }).then(async (response) => ({
    status: response.status, headers: Object.fromEntries(response.headers), body: await response.text(),
  }));
}
