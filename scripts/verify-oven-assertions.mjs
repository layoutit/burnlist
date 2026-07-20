import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeOvenPackage } from "../src/ovens/oven-contract.mjs";

export function assertBuiltInOvenSet(repoRoot, expected) {
  const ovensRoot = resolve(repoRoot, "ovens");
  const actual = readdirSync(ovensRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(ovensRoot, entry.name, "instructions.md")))
    .filter((entry) => readdirSync(join(ovensRoot, entry.name))
      .some((name) => name.endsWith(".oven") && name === `${entry.name}.oven`))
    .map((entry) => entry.name)
    .sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    console.error(`Default Oven ids must be exactly ${wanted.join(", ")}; found ${actual.join(", ") || "none"}.`);
    process.exit(1);
  }
}

export function assertSkillSet(repoRoot, expected) {
  const skillsRoot = resolve(repoRoot, "skills");
  const actual = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    console.error(`Published skill ids must be exactly ${wanted.join(", ")}; found ${actual.join(", ") || "none"}.`);
    process.exit(1);
  }
}

export function assertBuiltInOven(repoRoot, id, expectedName) {
  const root = resolve(repoRoot, "ovens", id);
  try {
    const ovenPackage = normalizeOvenPackage({
      id,
      instructions: readFileSync(resolve(root, "instructions.md"), "utf8"),
      oven: readFileSync(resolve(root, `${id}.oven`), "utf8"),
    });
    const heading = ovenPackage.instructions
      .split(/\r?\n/u)
      .find((line) => /^#\s+\S/u.test(line.trim()))
      ?.trim()
      .replace(/^#\s+/u, "");
    if (heading !== expectedName) throw new Error(`expected heading "${expectedName}", found "${heading || "none"}"`);
  } catch (error) {
    console.error(`Default oven ${id} violates the Oven contract: ${error.message}`);
    process.exit(1);
  }
}
