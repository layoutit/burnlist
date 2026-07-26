import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ensureSharedService, serviceStatus, stopRuntime } from "../service/supervisor.mjs";

function versionAt(packageRoot) {
  return JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
}

export async function runServiceCli({ args, packageRoot, cwd = process.cwd(), env = process.env, log = console.log, error = console.error }) {
  const command = args[1] ?? "status";
  try {
    if (command === "status") {
      const status = await serviceStatus({ env });
      log(status.running ? `Burnlist service is running at ${status.runtime.url}` : "Burnlist service is stopped.");
      return status.running ? 0 : 1;
    }
    if (command === "stop") {
      const status = await serviceStatus({ env });
      if (!status.running) {
        log("Burnlist service is already stopped.");
        return 0;
      }
      if (!await stopRuntime(status.runtime)) throw new Error("the running service rejected the shutdown request");
      log("Stopped Burnlist service.");
      return 0;
    }
    if (command === "start" || command === "restart") {
      if (command === "restart") {
        const status = await serviceStatus({ env });
        if (status.running && !await stopRuntime(status.runtime)) throw new Error("the running service rejected the restart request");
      }
      const runtime = await ensureSharedService({ packageRoot, version: versionAt(packageRoot), cwd, env });
      log(`Burnlist service is running at ${runtime.url}`);
      return 0;
    }
    throw new Error(`unknown service command: ${command}. Use start, stop, restart, or status.`);
  } catch (cause) {
    error(`Burnlist: ${cause.message}`);
    return 1;
  }
}
