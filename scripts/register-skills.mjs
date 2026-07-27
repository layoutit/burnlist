#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { registerSkills, registrationScope } from "../src/cli/skills-register.mjs";
import { installMarker } from "../src/service/runtime.mjs";
import { readFileSync } from "node:fs";
import { ensureSharedService } from "../src/service/supervisor.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (process.env.npm_lifecycle_event === "postinstall" && process.env.npm_config_global !== "true" && args.length === 0) {
  console.log("Burnlist: local npm install detected; agent skill registration is only performed for global installs.");
} else {
  try {
    const scope = registrationScope(args);
    registerSkills({
      sourceRoot: resolve(packageRoot, "skills"),
      scope,
      dryRun: args.includes("--dry-run"),
    });
    if (scope === "global" && !args.includes("--dry-run")) {
      const version = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version;
      installMarker(packageRoot, version);
      if (process.env.npm_lifecycle_event === "postinstall" && process.env.npm_config_global === "true") {
        const runtime = await ensureSharedService({ packageRoot, version, cwd: packageRoot });
        console.log(`Burnlist service: ${runtime.url}`);
      }
    }
  } catch (error) {
    console.error(`Burnlist: ${error.message}`);
    process.exitCode = 1;
  }
}
