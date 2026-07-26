#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ownedGlobalInstall, removeInstallMarker } from "../src/service/runtime.mjs";
import { serviceStatus, stopRuntime } from "../src/service/supervisor.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const version = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
  if (ownedGlobalInstall(packageRoot, version)) {
    const status = await serviceStatus();
    if (status.running && !await stopRuntime(status.runtime)) {
      throw new Error("the owned Burnlist service did not stop");
    }
    removeInstallMarker(packageRoot);
    console.log("Burnlist: stopped and removed the global service registration.");
  }
} catch (error) {
  console.error(`Burnlist: ${error.message}`);
  process.exitCode = 1;
}
