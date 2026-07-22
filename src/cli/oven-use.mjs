import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateOvenData } from "../ovens/oven-data-validate.mjs";
import { canonicalOvenDataPath, OVEN_DATA_MAX_BYTES, publishOvenData } from "../server/oven-data-store.mjs";
import { vendoredOvenPath, writeVendoredOven } from "../server/oven-vendor.mjs";
import { assertGitIgnored } from "./git-ignore.mjs";
import { readBoundedInput } from "./oven-storage.mjs";

function invalidData(id, errors) {
  const details = errors.map((error) => `  ${error.path}: ${error.message}`).join("\n");
  return new Error(`Oven ${id} example data validation failed:\n${details}`);
}

function examplePayload(path) {
  const source = readBoundedInput(path, OVEN_DATA_MAX_BYTES, "Oven example data");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Oven example data must be valid JSON: ${error.message}`);
  }
}

function adoptedOutput(saved, path) {
  return `Adopted Oven ${saved.id}@${saved.version} at ${path}`;
}

export function useShippedOven({
  id,
  repoRoot,
  builtInOvensDir,
  readOvenDir,
  force = false,
  now = () => new Date(),
  writeVendor = writeVendoredOven,
} = {}) {
  const shipped = readOvenDir(builtInOvensDir, id, true);
  if (!shipped) throw new Error(`Oven ${id} is not a shipped built-in.`);
  const targetPath = vendoredOvenPath(repoRoot, shipped.id);
  if (existsSync(targetPath) && !force) {
    throw new Error(`Oven ${shipped.id} is already vendored at ${targetPath}.`);
  }

  const examplePath = join(builtInOvensDir, shipped.id, "example", "data.json");
  const timestamp = now();
  const adopt = () => writeVendor(repoRoot, {
    id: shipped.id,
    instructions: shipped.instructions,
    oven: shipped.oven,
    now: timestamp,
  });
  if (!existsSync(examplePath)) {
    const saved = adopt();
    return {
      warnings: [],
      output: `${adoptedOutput(saved, targetPath)}\nNo example/data.json is shipped; adopted without data.\nNext: burnlist oven set ${saved.id} <data> --repo ${JSON.stringify(repoRoot)}`,
    };
  }

  const payload = examplePayload(examplePath);
  const dataPath = canonicalOvenDataPath(repoRoot, shipped.id);
  const validation = validateOvenData(shipped, payload, {
    bindingPath: dataPath,
    maxOvenDataBytes: OVEN_DATA_MAX_BYTES,
  });
  if (!validation.ok) throw invalidData(shipped.id, validation.errors);
  assertGitIgnored(repoRoot, dataPath);
  let savedOven;
  const savedData = publishOvenData(
    repoRoot,
    shipped.id,
    `${JSON.stringify(payload, null, 2)}\n`,
    timestamp.toISOString(),
    { commit() { savedOven = adopt(); } },
  );
  return {
    warnings: validation.warnings,
    output: `${adoptedOutput(savedOven, targetPath)}\nSet shipped example data for Oven ${shipped.id}.\nData: ${savedData.dataPath}\nBinding: ${savedData.bindingPath}`,
  };
}
