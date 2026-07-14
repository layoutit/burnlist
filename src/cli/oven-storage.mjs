import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeOvenDetail, normalizeOvenForkedFrom, normalizeOvenPackage, ovenId, ovenRevision } from "../ovens/oven-contract.mjs";
import { atomicOvenPackage, resolveOvenPackageDir, withOvenPackageLock } from "../server/fs-safe.mjs";
import {
  assertCustomOvensDir,
  assertCustomOvenPath,
  OVEN_DETAIL_MAX_BYTES,
  OVEN_INSTRUCTIONS_MAX_BYTES,
  OVEN_LINEAGE_MAX_BYTES,
  serializeOvenPackage,
} from "../server/oven-storage.mjs";

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function readTextFileWithLimit(path, maxBytes, label) {
  const stat = statSync(path);
  if (stat.size > maxBytes) throw new Error(`${label} is ${stat.size} bytes, over the ${maxBytes} byte limit.`);
  return readFileSync(path, "utf8");
}

function instructionsName(instructions, fallback) {
  const heading = instructions.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line.trim()));
  return heading ? heading.trim().replace(/^#\s+/u, "").trim() : fallback;
}

function instructionsDescription(instructions) {
  return instructions
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? "";
}

export function createOvenCatalog({ builtInOvensDir, customOvensDir, customRepoRoot, unsafeOvensDir }) {
  function readOvenDir(root, id, builtIn) {
    const safeId = ovenId(id);
    let ovenRoot;
    try {
      const path = builtIn ? join(root, safeId) : assertCustomOvenPath(customRepoRoot, root, safeId, { unsafe: unsafeOvensDir });
      ovenRoot = resolveOvenPackageDir(realpathSync(path));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    try {
      const instructionsPath = join(ovenRoot, "instructions.md");
      const detailPath = join(ovenRoot, "detail.json");
      if (!safeStat(instructionsPath)?.isFile() || !safeStat(detailPath)?.isFile()) return null;
      const ovenPackage = normalizeOvenPackage({
        id: safeId,
        instructions: readTextFileWithLimit(instructionsPath, OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions"),
        detail: JSON.parse(readTextFileWithLimit(detailPath, OVEN_DETAIL_MAX_BYTES, "Oven detail template")),
      });
      const lineagePath = join(ovenRoot, "oven.json");
      let forkedFrom;
      if (safeStat(lineagePath)?.isFile()) {
        try {
          forkedFrom = normalizeOvenForkedFrom(
            JSON.parse(readTextFileWithLimit(lineagePath, OVEN_LINEAGE_MAX_BYTES, "Oven lineage sidecar")),
          ).forkedFrom;
        } catch (error) {
          throw new Error(`Oven ${safeId} lineage sidecar is invalid: ${error.message}`);
        }
      }
      return {
        id: ovenPackage.id,
        name: instructionsName(ovenPackage.instructions, safeId),
        description: instructionsDescription(ovenPackage.instructions),
        builtIn,
        path: ovenRoot,
        instructions: ovenPackage.instructions,
        detail: ovenPackage.detail,
        ovenRevision: ovenRevision(ovenPackage),
        ...(forkedFrom ? { forkedFrom } : {}),
      };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  function ovensIn(root, builtIn) {
    if (!builtIn) assertCustomOvensDir(customRepoRoot, root, { unsafe: unsafeOvensDir });
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    return entries
      .map((entry) => entry.name)
      .filter((id) => !id.startsWith(".") && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
      .map((id) => {
        try {
          return readOvenDir(root, id, builtIn);
        } catch (error) {
          console.warn(`Ignoring malformed Oven ${id}: ${error.message}`);
          return null;
        }
      })
      .filter(Boolean);
  }

  return {
    readOvenDir,
    discoverOvens() {
      const byId = new Map();
      for (const oven of ovensIn(builtInOvensDir, true)) byId.set(oven.id, oven);
      for (const oven of ovensIn(customOvensDir, false)) if (!byId.get(oven.id)?.builtIn) byId.set(oven.id, oven);
      return [...byId.values()].sort(
        (left, right) => Number(right.builtIn) - Number(left.builtIn) || left.name.localeCompare(right.name),
      );
    },
    findOven(id) {
      const safeId = ovenId(id);
      return readOvenDir(builtInOvensDir, safeId, true) ?? readOvenDir(customOvensDir, safeId, false);
    },
  };
}

function readInput(spec, maxBytes, label) {
  if (spec === "-") {
    const value = readFileSync(0, "utf8");
    if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
    return value;
  }
  return readTextFileWithLimit(resolve(spec), maxBytes, label);
}

export function resolvePackageInput({ flags, positionals }) {
  const pkg = {};
  if (flags.has("package")) Object.assign(pkg, JSON.parse(readInput(flags.get("package"), OVEN_DETAIL_MAX_BYTES, "Oven package")));
  if (flags.has("dir")) {
    const dir = resolve(flags.get("dir"));
    pkg.instructions = readTextFileWithLimit(join(dir, "instructions.md"), OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions");
    pkg.detail = JSON.parse(readTextFileWithLimit(join(dir, "detail.json"), OVEN_DETAIL_MAX_BYTES, "Oven detail template"));
  }
  if (flags.has("instructions")) pkg.instructions = readInput(flags.get("instructions"), OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions");
  if (flags.has("detail")) pkg.detail = JSON.parse(readInput(flags.get("detail"), OVEN_DETAIL_MAX_BYTES, "Oven detail template"));

  const id = ovenId(positionals[0] ?? pkg.id ?? flags.get("id") ?? "");
  const name = flags.has("name") ? String(flags.get("name")).trim() : String(pkg.name ?? "").trim();
  if (pkg.instructions === undefined) throw new Error("Provide instructions via --instructions, --package, or --dir.");
  if (pkg.detail === undefined) throw new Error("Provide a detail skeleton via --detail, --package, or --dir.");

  let instructions = String(pkg.instructions);
  if (name) {
    const lines = instructions.split(/\r?\n/u);
    const headingIndex = lines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
    if (headingIndex === -1) lines.unshift(`# ${name}`, "");
    else lines[headingIndex] = `# ${name}`;
    instructions = lines.join("\n");
  }
  return normalizeOvenPackage({ id, instructions, detail: normalizeOvenDetail(pkg.detail) });
}

export function persistOven({ customRepoRoot, customOvensDir, unsafeOvensDir }, pkg, { allowReplace, sidecar }) {
  const files = serializeOvenPackage({ ...pkg, sidecar });
  try {
    assertCustomOvenPath(customRepoRoot, customOvensDir, pkg.id, { unsafe: unsafeOvensDir });
    return withOvenPackageLock(customOvensDir, pkg.id, () => atomicOvenPackage(customOvensDir, pkg.id, files, {
      replace: allowReplace,
      assertPath: () => assertCustomOvenPath(customRepoRoot, customOvensDir, pkg.id, { unsafe: unsafeOvensDir }),
    }));
  } catch (error) {
    if (!allowReplace && error.message === `${pkg.id} already exists.`) {
      throw new Error(`Oven ${pkg.id} already exists. Use \`oven update ${pkg.id}\` or --force.`);
    }
    throw error;
  }
}
