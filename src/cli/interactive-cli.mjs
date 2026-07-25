import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function interactiveBinaryPath(packageRoot, platform = process.platform) {
  return resolve(packageRoot, "tui", "dist", platform === "win32" ? "burnlist-tui.exe" : "burnlist-tui");
}

export function interactiveTuiTargets(packageRoot, readFile = readFileSync) {
  try {
    const packageJson = JSON.parse(readFile(resolve(packageRoot, "package.json"), "utf8"));
    const targets = packageJson.burnlistTui?.targets;
    return Array.isArray(targets) && targets.every((target) => typeof target === "string") ? targets : [];
  } catch {
    return [];
  }
}

export function runInteractiveCli({
  args,
  packageRoot,
  platform = process.platform,
  arch = process.arch,
  spawn = spawnSync,
  exists = existsSync,
  readFile = readFileSync,
  error = console.error,
}) {
  const target = `${platform}-${arch}`;
  const targets = interactiveTuiTargets(packageRoot, readFile);
  if (!targets.includes(target)) {
    error(`Burnlist terminal UI is currently packaged only for ${targets.join(", ") || "no declared targets"}; this installation is ${target}. The Node CLI and dashboard remain available on this host.`);
    return 1;
  }
  const binary = interactiveBinaryPath(packageRoot, platform);
  if (!exists(binary)) {
    error(`Burnlist terminal UI is not built: ${binary}\nRun npm run build:tui, then retry burnlist -i.`);
    return 1;
  }
  const forwarded = args.filter((arg) => arg !== "-i" && arg !== "--interactive");
  const result = spawn(binary, forwarded, { stdio: "inherit", shell: false });
  if (result.error) {
    error(`Cannot launch Burnlist terminal UI: ${result.error.message}`);
    return 1;
  }
  if (typeof result.status === "number") return result.status;
  return result.signal ? 128 : 1;
}
