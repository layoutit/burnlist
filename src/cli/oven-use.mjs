import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ovenDefinitionChangedInput,
  publishCanonicalMutation,
} from "../events/oven-canonical-mutations.mjs";
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

function noExampleAdoptionOutput(saved, targetPath, repoRoot, catalogEntry) {
  const adopted = `${adoptedOutput(saved, targetPath)}\nNo example/data.json is shipped; adopted without data.`;
  // `routeKind` is catalog-owned semantics, not a presentation guess by id.
  // Burnlist lenses are hydrated by core transport, so a hand-authored snapshot
  // would be both unnecessary and misleading.
  if (catalogEntry?.routeKind === "burnlist-lens") {
    return `${adopted}\nData is supplied by Burnlist core transport; no local data action is needed.`;
  }
  return `${adopted}\nNext: burnlist oven set ${saved.id} <data> --repo ${JSON.stringify(repoRoot)}`;
}

function eventWarning(error) {
  const detail = String(error?.message ?? error ?? "unknown error")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(0, 200);
  return `Canonical Oven data was set, but its observational event failed: ${detail || "unknown error"}`;
}

function publishAdoptionEvent(repoRoot, saved, timestamp, warnings, publishDefinitionEvent) {
  publishCanonicalMutation(repoRoot, ovenDefinitionChangedInput({
    ovenId: saved.id,
    action: "adopted",
    revision: saved.revision,
    generation: saved.pin.pinnedAt,
    occurredAt: timestamp.toISOString(),
  }), {
    ...(publishDefinitionEvent ? { publishEvent: publishDefinitionEvent } : {}),
    onError(error) {
      const detail = String(error?.message ?? error ?? "unknown error")
        .replace(/[\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, 200);
      warnings.push(`Canonical Oven definition was adopted, but its observational event failed: ${detail || "unknown error"}`);
    },
  });
}

export function useShippedOven({
  id,
  repoRoot,
  builtInOvensDir,
  readOvenDir,
  force = false,
  now = () => new Date(),
  writeVendor = writeVendoredOven,
  publishDataEvent,
  publishDefinitionEvent,
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
    runtimeCompatibility: shipped.catalogEntry?.runtimeCompatibility,
    now: timestamp,
  });
  if (!existsSync(examplePath)) {
    const saved = adopt();
    const observerWarnings = [];
    publishAdoptionEvent(repoRoot, saved, timestamp, observerWarnings, publishDefinitionEvent);
    return {
      warnings: observerWarnings,
      output: noExampleAdoptionOutput(saved, targetPath, repoRoot, shipped.catalogEntry),
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
  const observerWarnings = [];
  const savedData = publishOvenData(
    repoRoot,
    shipped.id,
    `${JSON.stringify(payload, null, 2)}\n`,
    timestamp.toISOString(),
    {
      commit() { savedOven = adopt(); },
      ...(publishDataEvent ? { publishDataEvent } : {}),
      onOvenEventError(error) { observerWarnings.push(eventWarning(error)); },
    },
  );
  publishAdoptionEvent(repoRoot, savedOven, timestamp, observerWarnings, publishDefinitionEvent);
  return {
    warnings: [...validation.warnings, ...observerWarnings],
    output: `${adoptedOutput(savedOven, targetPath)}\nSet shipped example data for Oven ${shipped.id}.\nData: ${savedData.dataPath}\nBinding: ${savedData.bindingPath}`,
  };
}
