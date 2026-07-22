import { readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeOvenForkedFrom, normalizeOvenPackage, ovenId, ovenRevision } from "../ovens/oven-contract.mjs";
import { compileOven } from "../ovens/dsl/oven-compile.mjs";
import { loadOfficialOvenCatalog, officialOvenEntry } from "../ovens/official-oven-catalog.mjs";
import { starterOvenSource } from "../ovens/oven-starter.mjs";
import { atomicOvenPackage, resolveOvenPackageDir, withOvenPackageLock } from "../server/fs-safe.mjs";
import {
  assertCustomOvensDir,
  assertCustomOvenPath,
  OVEN_SOURCE_MAX_BYTES,
  OVEN_INSTRUCTIONS_MAX_BYTES,
  OVEN_LINEAGE_MAX_BYTES,
  serializeOvenPackage,
} from "../server/oven-storage.mjs";
import { assertGitIgnored } from "./git-ignore.mjs";

// This carries both stored files plus JSON escaping and authoring whitespace.
// It is intentionally a transport limit, not a stored-file limit.
export const OVEN_PACKAGE_MAX_BYTES = 1_048_576;

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

export function createOvenCatalog({ builtInOvensDir, customOvensDir, customRepoRoot, unsafeOvensDir, handlers }) {
  const officialCatalog = loadOfficialOvenCatalog({ ovensDir: builtInOvensDir, handlers });

  function readOvenDir(root, id, builtIn) {
    const safeId = ovenId(id);
    const catalogEntry = builtIn ? officialOvenEntry(officialCatalog, safeId) : null;
    if (builtIn && !catalogEntry) return null;
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
      const ovenPath = join(ovenRoot, `${safeId}.oven`);
      if (!safeStat(instructionsPath)?.isFile() || !safeStat(ovenPath)?.isFile()) return null;
      const ovenPackage = normalizeOvenPackage({
        id: safeId,
        instructions: readTextFileWithLimit(instructionsPath, OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions"),
        oven: readTextFileWithLimit(ovenPath, OVEN_SOURCE_MAX_BYTES, "Oven source"),
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
      const ir = compileOven(ovenPackage.oven).ir;
      if (catalogEntry && (ir.id !== catalogEntry.id
        || ir.version !== catalogEntry.version || ir.contract !== catalogEntry.contract)) {
        throw new Error(`Official Oven ${safeId} no longer matches catalog revision ${officialCatalog.catalogRevision}.`);
      }
      return {
        id: ovenPackage.id,
        name: instructionsName(ovenPackage.instructions, safeId),
        description: instructionsDescription(ovenPackage.instructions),
        builtIn,
        origin: builtIn ? "official" : "custom",
        catalogRevision: builtIn ? officialCatalog.catalogRevision : null,
        catalogEntry,
        path: ovenRoot,
        instructions: ovenPackage.instructions,
        oven: ovenPackage.oven,
        ir,
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
    officialCatalog,
    readOvenDir,
    discoverOvens() {
      const byId = new Map();
      for (const entry of officialCatalog.entries) {
        const oven = readOvenDir(builtInOvensDir, entry.id, true);
        if (!oven) throw new Error(`Official Oven ${entry.id} is unavailable.`);
        byId.set(oven.id, oven);
      }
      for (const oven of ovensIn(customOvensDir, false)) if (!byId.get(oven.id)?.builtIn) byId.set(oven.id, oven);
      return [...byId.values()].sort(
        (left, right) => Number(right.builtIn) - Number(left.builtIn) || left.name.localeCompare(right.name),
      );
    },
    findOven(id) {
      const safeId = ovenId(id);
      const official = officialOvenEntry(officialCatalog, safeId)
        ? readOvenDir(builtInOvensDir, safeId, true)
        : null;
      return official ?? readOvenDir(customOvensDir, safeId, false);
    },
  };
}

export function readBoundedInput(spec, maxBytes, label) {
  if (spec === "-") {
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(65_536, maxBytes + 1));
    while (total <= maxBytes) {
      const bytes = readSync(0, buffer, 0, Math.min(buffer.length, maxBytes + 1 - total), null);
      if (bytes === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytes)));
      total += bytes;
    }
    if (total > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
    return Buffer.concat(chunks, total).toString("utf8");
  }
  return readTextFileWithLimit(resolve(spec), maxBytes, label);
}

export function resolvePackageInput({ flags, positionals, scaffold = false }) {
  const pkg = {};
  if (flags.has("package")) Object.assign(pkg, JSON.parse(readBoundedInput(flags.get("package"), OVEN_PACKAGE_MAX_BYTES, "Oven package")));
  const id = ovenId(positionals[0] ?? pkg.id ?? flags.get("id") ?? "");
  if (flags.has("dir")) {
    const dir = resolve(flags.get("dir"));
    pkg.instructions = readTextFileWithLimit(join(dir, "instructions.md"), OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions");
    pkg.oven = readTextFileWithLimit(join(dir, `${id}.oven`), OVEN_SOURCE_MAX_BYTES, "Oven source");
  }
  if (flags.has("instructions")) pkg.instructions = readBoundedInput(flags.get("instructions"), OVEN_INSTRUCTIONS_MAX_BYTES, "Oven instructions");
  if (flags.has("oven")) pkg.oven = readBoundedInput(flags.get("oven"), OVEN_SOURCE_MAX_BYTES, "Oven source");

  const name = flags.has("name") ? String(flags.get("name")).trim() : String(pkg.name ?? "").trim();
  if (pkg.instructions === undefined) throw new Error("Provide instructions via --instructions, --package, or --dir.");

  let instructions = String(pkg.instructions);
  if (name) {
    const lines = instructions.split(/\r?\n/u);
    const headingIndex = lines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
    if (headingIndex === -1) lines.unshift(`# ${name}`, "");
    else lines[headingIndex] = `# ${name}`;
    instructions = lines.join("\n");
  }
  if (pkg.oven === undefined) {
    if (!scaffold) throw new Error("Provide Oven source via --oven, --package, or --dir.");
    pkg.oven = starterOvenSource(id, name || instructionsName(instructions, id));
  }
  const normalized = normalizeOvenPackage({ id, instructions, oven: pkg.oven });
  // Serialize here as well as at persist time so every input shape receives
  // the same independent instructions.md and .oven byte checks.
  serializeOvenPackage(normalized);
  return normalized;
}

export function persistOven({ customRepoRoot, customOvensDir, unsafeOvensDir }, pkg, { allowReplace, sidecar }) {
  const files = serializeOvenPackage({ ...pkg, sidecar });
  try {
    assertCustomOvenPath(customRepoRoot, customOvensDir, pkg.id, { unsafe: unsafeOvensDir });
    assertGitIgnored(customRepoRoot, customOvensDir);
    return withOvenPackageLock(customOvensDir, pkg.id, () => atomicOvenPackage(customOvensDir, pkg.id, files, {
      replace: allowReplace,
      assertPath: () => {
        assertCustomOvenPath(customRepoRoot, customOvensDir, pkg.id, { unsafe: unsafeOvensDir });
        assertGitIgnored(customRepoRoot, customOvensDir);
      },
    }));
  } catch (error) {
    if (!allowReplace && error.message === `${pkg.id} already exists.`) {
      throw new Error(`Oven ${pkg.id} already exists. Use \`oven update ${pkg.id}\` or --force.`);
    }
    throw error;
  }
}
