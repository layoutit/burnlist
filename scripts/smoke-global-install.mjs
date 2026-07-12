#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = mkdtempSync(join(tmpdir(), "burnlist-global-install-"));
const home = join(tmpRoot, "home");
const prefix = join(tmpRoot, "prefix");
const packRoot = join(tmpRoot, "pack");
const npmCache = join(tmpRoot, "npm-cache");
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  npm_config_cache: npmCache,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: options.capture ? "utf8" : undefined,
    env,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function assertManagedLink(name, packageRoot) {
  const target = join(home, ".agents", "skills", name);
  const stat = lstatSync(target);
  if (!stat.isSymbolicLink()) throw new Error(`${target} is not a symlink`);
  const actual = realpathSync(resolve(dirname(target), readlinkSync(target)));
  const expected = realpathSync(resolve(packageRoot, "skills", name));
  if (actual !== expected) throw new Error(`${target} points to ${actual}, expected ${expected}`);
}

let exitCode = 0;
try {
  mkdirSync(home, { recursive: true });
  mkdirSync(prefix, { recursive: true });
  mkdirSync(packRoot, { recursive: true });
  const packJson = run("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packRoot,
  ], { capture: true });
  const [packReport] = JSON.parse(packJson);
  const tarball = resolve(packRoot, packReport.filename);

  run("npm", ["install", "--global", "--prefix", prefix, tarball]);
  const globalRoot = run("npm", ["root", "--global", "--prefix", prefix], { capture: true });
  const packageRoot = resolve(globalRoot, "burnlist");
  assertManagedLink("burnlist", packageRoot);

  const cli = process.platform === "win32"
    ? join(prefix, "burnlist.cmd")
    : join(prefix, "bin", "burnlist");
  const version = run(cli, ["--version"], { capture: true });
  if (version !== packReport.version) {
    throw new Error(`installed CLI reported ${version}, expected ${packReport.version}`);
  }
  run(cli, ["--stamp"], { capture: true });
  const sdkPath = run(cli, ["differential-testing", "sdk"], { capture: true });
  const expectedSdkPath = resolve(packageRoot, "skills", "burnlist", "scripts", "differential-testing-adapter-sdk.mjs");
  if (realpathSync(sdkPath) !== realpathSync(expectedSdkPath)) throw new Error(`installed CLI reported unexpected SDK path: ${sdkPath}`);
  run(process.execPath, ["--input-type=module", "--eval", `const sdk = await import(${JSON.stringify(pathToFileURL(sdkPath).href)}); if (typeof sdk.createDifferentialTestingRefreshQueue !== "function" || typeof sdk.publishDifferentialTestingOvenBundle !== "function") process.exit(1);`]);

  run(cli, ["uninstall"]);
  for (const name of ["burnlist"]) {
    try {
      lstatSync(join(home, ".agents", "skills", name));
      throw new Error(`uninstall left the ${name} skill registration behind`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  console.log("Global npm install smoke test passed.");
} catch (error) {
  console.error(error.message);
  exitCode = 1;
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

process.exit(exitCode);
