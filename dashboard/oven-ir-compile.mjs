import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileOven } from "../src/ovens/dsl/oven-compile.mjs";

const dashboardDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(dashboardDir, "..");

export function compileOvenIrForJsonPath(irJsonAbsPath) {
  if (!irJsonAbsPath.endsWith(".ir.json")) {
    throw new Error(`Expected an .ir.json path, got ${irJsonAbsPath}`);
  }

  const ovenPath = `${irJsonAbsPath.slice(0, -".ir.json".length)}.oven`;
  const file = relative(repoRoot, ovenPath).split(sep).join("/");
  const compiled = compileOven(readFileSync(ovenPath, "utf8"), { file });
  if (!compiled.ok) {
    throw new Error(`Failed to compile ${file}: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled.ir;
}
