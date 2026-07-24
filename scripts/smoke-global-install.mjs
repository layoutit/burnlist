#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const {
  BURNLIST_CLAUDE_SKILLS_DIR: ignoredClaudeSkillsDir,
  BURNLIST_SKILLS_DIR: ignoredCodexSkillsDir,
  ...smokeEnv
} = process.env;
const env = {
  ...smokeEnv,
  HOME: home,
  USERPROFILE: home,
  npm_config_cache: npmCache,
};
const tuiTarget = "darwin-arm64";

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

function runFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    stdio: "pipe",
  });
  if (result.status === 0) throw new Error(`${command} ${args.join(" ")} unexpectedly succeeded`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function runPty(binary, marker, label, interactive = false) {
  const observation = join(tmpRoot, `${label}.pty-observed.txt`);
  const result = spawnSync("expect", ["-c", `
set timeout 20
log_user 1
if {$env(BURNLIST_PTY_INTERACTIVE) eq "1"} {
  spawn -noecho $env(BURNLIST_PTY_BINARY) -i
} else {
  spawn -noecho $env(BURNLIST_PTY_BINARY)
}
expect {
  -re $env(BURNLIST_PTY_MARKER) {
    set observation [open $env(BURNLIST_PTY_OBSERVATION) w]
    puts $observation $env(BURNLIST_PTY_MARKER)
    close $observation
    send "\\033"
  }
  eof { puts stderr "${label} exited before rendering ${marker}"; exit 126 }
  timeout { puts stderr "${label} did not render ${marker}"; exit 124 }
}
expect {
  eof {}
  timeout { puts stderr "${label} did not exit after root Escape"; exit 125 }
}
set outcome [wait]
exit [lindex $outcome 3]
`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...env, BURNLIST_PTY_BINARY: binary, BURNLIST_PTY_MARKER: marker, BURNLIST_PTY_OBSERVATION: observation, BURNLIST_PTY_INTERACTIVE: interactive ? "1" : "0" },
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    stdio: "pipe",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) throw new Error(`${label} PTY smoke failed: ${output}`);
  if (readFileSync(observation, "utf8") !== `${marker}\n`) throw new Error(`${label} PTY smoke did not observe recognizable content: ${marker}`);
}

function assertManagedLink(agentDirectory, name, packageRoot) {
  const target = join(home, agentDirectory, "skills", name);
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
  assertManagedLink(".claude", "burnlist", packageRoot);
  assertManagedLink(".agents", "burnlist", packageRoot);

  const cli = process.platform === "win32"
    ? join(prefix, "burnlist.cmd")
    : join(prefix, "bin", "burnlist");
  const version = run(cli, ["--version"], { capture: true });
  if (version !== packReport.version) {
    throw new Error(`installed CLI reported ${version}, expected ${packReport.version}`);
  }
  run(cli, ["--stamp"], { capture: true });
  run(cli, ["oven", "list"], { capture: true });
  const installedTarget = `${process.platform}-${process.arch}`;
  if (installedTarget === tuiTarget) {
    runPty(cli, "Burnlist", "interactive CLI", true);
    runPty(join(packageRoot, "tui", "dist", "burnlist-tui-catalog"), "Terminal catalog", "catalog binary");
  } else {
    const output = runFailure(cli, ["-i"]);
    if (!output.includes(tuiTarget) || !output.includes(installedTarget)) {
      throw new Error(`unsupported host interactive CLI message is not actionable: ${output}`);
    }
  }
  const sdkPath = run(cli, ["differential-testing", "sdk"], { capture: true });
  const expectedSdkPath = resolve(packageRoot, "ovens", "differential-testing", "engine", "adapter-sdk.mjs");
  if (realpathSync(sdkPath) !== realpathSync(expectedSdkPath)) throw new Error(`installed CLI reported unexpected SDK path: ${sdkPath}`);
  run(process.execPath, ["--input-type=module", "--eval", `
    const sdk = await import(${JSON.stringify(pathToFileURL(sdkPath).href)});
    const expected = [
      "DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION",
      "DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA",
      "assertDifferentialTestingWorkerState",
      "createDifferentialTestingWorker",
      "readDifferentialTestingWorkerState",
    ];
    if (sdk.DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION !== 4
      || JSON.stringify(Object.keys(sdk).sort()) !== JSON.stringify(expected.sort())) process.exit(1);
  `]);
  run(process.execPath, ["--input-type=module", "--eval", `
    const events = await import("burnlist/oven-events");
    const expected = ["normalizeOvenEvent", "publishOvenEvent", "readOvenEvents"];
    if (!expected.every((name) => typeof events[name] === "function")) process.exit(1);
  `], { cwd: packageRoot });

  run(cli, ["uninstall", "--global", "--purge"]);
  for (const agentDirectory of [".claude", ".agents"]) {
    for (const name of ["burnlist"]) {
      try {
        lstatSync(join(home, agentDirectory, "skills", name));
        throw new Error(`uninstall left the ${agentDirectory} ${name} skill registration behind`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
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
