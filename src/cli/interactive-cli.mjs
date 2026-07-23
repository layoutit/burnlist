import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function interactiveBinaryPath(packageRoot, platform = process.platform) {
  return resolve(packageRoot, "tui", "dist", platform === "win32" ? "burnlist-tui.exe" : "burnlist-tui");
}

export function runInteractiveCli({
  args,
  packageRoot,
  platform = process.platform,
  spawn = spawnSync,
  exists = existsSync,
  error = console.error,
}) {
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
