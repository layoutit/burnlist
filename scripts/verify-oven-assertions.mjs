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

function containsJsonSchema(path) {
  return readdirSync(path, { withFileTypes: true }).some((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? containsJsonSchema(entryPath) : entry.name.endsWith(".schema.json");
  });
}

export function assertBuiltInOvenDataDocs(repoRoot, id, { dataInput, validator }) {
  const root = resolve(repoRoot, "ovens", id);
  const instructions = readFileSync(join(root, "instructions.md"), "utf8");
  const exampleExists = existsSync(join(root, "example", "data.json"));
  const expected = [
    "## Data Shape",
    `- Input mode: \`${dataInput}\`.`,
    `- Runtime validator: \`${validator ?? "none"}\`.`,
    exampleExists ? "- Starter data: `example/data.json`." : "- Starter data: none.",
  ];
  const missing = expected.filter((line) => !instructions.includes(line));
  const starterLines = instructions.split(/\r?\n/u).filter((line) => line.startsWith("- Starter data:"));
  if (missing.length || starterLines.length !== 1) {
    console.error(`Default oven ${id} instructions do not accurately declare data input, validator, and starter availability: ${missing.join(", ") || "duplicate starter declaration"}.`);
    process.exit(1);
  }
  if (containsJsonSchema(root)
    && !/JSON Schema is informational reference\s+documentation only; it is not the validation authority\./u.test(instructions)) {
    console.error(`Default oven ${id} must label its JSON Schema as informational rather than authoritative.`);
    process.exit(1);
  }
}
