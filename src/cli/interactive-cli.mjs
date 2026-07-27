import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveInteractiveService } from "../service/supervisor.mjs";

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

export async function runInteractiveCli({
  args,
  packageRoot,
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  spawn = spawnSync,
  exists = existsSync,
  readFile = readFileSync,
  resolveService = resolveInteractiveService,
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
  const packageJson = JSON.parse(readFile(resolve(packageRoot, "package.json"), "utf8"));
  let service;
  try {
    service = await resolveService({ args, packageRoot, version: packageJson.version, cwd, env });
    const forwarded = args
      .filter((arg, index) => arg !== "-i" && arg !== "--interactive" && arg !== "--local"
        && !(args[index - 1] === "--server"))
      .filter((arg) => arg !== "--server");
    forwarded.push("--server", service.url);
    const result = spawn(binary, forwarded, { stdio: "inherit", shell: false });
    if (result.error) {
      error(`Cannot launch Burnlist terminal UI: ${result.error.message}`);
      return 1;
    }
    if (typeof result.status === "number") return result.status;
    return result.signal ? 128 : 1;
  } catch (cause) {
    error(`Cannot launch Burnlist terminal UI: ${cause.message}`);
    return 1;
  } finally {
    await service?.stop();
  }
}
