import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileOvenIrForJsonPath } from "./oven-ir-compile.mjs";

const dashboardDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(dashboardDir, "..");
const ovensDir = resolve(repoRoot, "ovens");
const virtualPrefix = "\0oven-ir:";

function withoutQuery(id) {
  return id.split(/[?#]/, 1)[0];
}

function isOvenIrPath(path) {
  const ovenRelativePath = relative(ovensDir, path);
  if (ovenRelativePath.startsWith(`..${sep}`) || isAbsolute(ovenRelativePath)) return false;
  const parts = ovenRelativePath.split(sep);
  if (parts.length !== 2) return false;
  const [ovenId, irName] = parts;
  return irName === `${ovenId}.ir.json`;
}

function ovenIrPath(source, importer) {
  const cleanSource = withoutQuery(source);
  const cleanImporter = importer && withoutQuery(importer);
  const candidate = isAbsolute(cleanSource)
    ? cleanSource
    : cleanImporter
      ? resolve(dirname(cleanImporter), cleanSource)
      : resolve(repoRoot, cleanSource);
  return isOvenIrPath(candidate) ? candidate : null;
}

function virtualId(irPath) {
  return `${virtualPrefix}${irPath}.mjs`;
}

function irPathFromId(id) {
  const cleanId = withoutQuery(id);
  if (!cleanId.startsWith(virtualPrefix) || !cleanId.endsWith(".mjs")) return null;
  const irPath = cleanId.slice(virtualPrefix.length, -".mjs".length);
  return isOvenIrPath(irPath) ? irPath : null;
}

export function ovenIrPlugin() {
  return {
    name: "oven-ir",
    resolveId(source, importer) {
      const path = ovenIrPath(source, importer);
      return path && { id: virtualId(path) };
    },
    load(id) {
      const irPath = irPathFromId(id);
      if (!irPath) return null;

      const ovenPath = `${irPath.slice(0, -".ir.json".length)}.oven`;
      this.addWatchFile(ovenPath);
      return `export default ${JSON.stringify(compileOvenIrForJsonPath(irPath))};`;
    },
  };
}
