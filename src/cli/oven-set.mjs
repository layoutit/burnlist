import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateOvenData } from "../ovens/oven-data-validate.mjs";
import { canonicalOvenDataPath, OVEN_DATA_MAX_BYTES, publishOvenData } from "../server/oven-data-store.mjs";
import { readVendoredOven, vendoredOvenPath } from "../server/oven-vendor.mjs";
import { assertGitIgnored } from "./git-ignore.mjs";
import { readBoundedInput } from "./oven-storage.mjs";

function selectedOven(repoRoot, id, findOven) {
  const vendored = readVendoredOven(repoRoot, id);
  if (vendored) return { ...vendored, builtIn: true, path: vendoredOvenPath(repoRoot, id) };
  return findOven(id);
}

function dataInput(spec, launchCwd) {
  let source;
  if (spec === "-" || existsSync(resolve(launchCwd, spec))) {
    source = readBoundedInput(spec, OVEN_DATA_MAX_BYTES, "Oven data");
  } else {
    if (Buffer.byteLength(spec, "utf8") > OVEN_DATA_MAX_BYTES) {
      throw new Error(`Oven data exceeds the ${OVEN_DATA_MAX_BYTES} byte limit.`);
    }
    source = spec;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Oven data input must be valid JSON: ${error.message}`);
  }
}

function invalidData(id, errors) {
  const details = errors.map((error) => `  ${error.path}: ${error.message}`).join("\n");
  return new Error(`Oven ${id} data validation failed:\n${details}`);
}

export function setOvenDataFromCli({ positionals, repoRoot, launchCwd, findOven, now = () => new Date() }) {
  const [id, input, ...extra] = positionals;
  if (!id || input === undefined || extra.length > 0) {
    throw new Error("Usage: burnlist oven set <id> <path|-|json> [--repo <path>]");
  }
  const oven = selectedOven(repoRoot, id, findOven);
  if (!oven) throw new Error(`Unknown Oven "${id}". Run \`burnlist oven list\`.`);
  const payload = dataInput(input, launchCwd);
  const dataPath = canonicalOvenDataPath(repoRoot, oven.id);
  const validation = validateOvenData(oven, payload, {
    bindingPath: dataPath,
    maxOvenDataBytes: OVEN_DATA_MAX_BYTES,
  });
  if (!validation.ok) throw invalidData(oven.id, validation.errors);
  assertGitIgnored(repoRoot, dataPath);
  const saved = publishOvenData(
    repoRoot,
    oven.id,
    `${JSON.stringify(payload, null, 2)}\n`,
    now().toISOString(),
  );
  return {
    warnings: validation.warnings,
    output: `Set Oven ${oven.id} data.\nData: ${saved.dataPath}\nBinding: ${saved.bindingPath}`,
  };
}
