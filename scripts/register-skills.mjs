#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { registerSkills, registrationScope } from "../src/cli/skills-register.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (process.env.npm_lifecycle_event === "postinstall" && process.env.npm_config_global !== "true" && args.length === 0) {
  console.log("Burnlist: local npm install detected; agent skill registration is only performed for global installs.");
} else {
  try {
    registerSkills({
      sourceRoot: resolve(packageRoot, "skills"),
      scope: registrationScope(args),
      dryRun: args.includes("--dry-run"),
    });
  } catch (error) {
    console.error(`Burnlist: ${error.message}`);
    process.exitCode = 1;
  }
}
