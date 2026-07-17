#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { registrationScope, unregisterSkills } from "../src/cli/skills-register.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

try {
  unregisterSkills({
    sourceRoot: resolve(packageRoot, "skills"),
    scope: registrationScope(args),
    dryRun: args.includes("--dry-run"),
  });
} catch (error) {
  console.error(`Burnlist: ${error.message}`);
  process.exitCode = 1;
}
