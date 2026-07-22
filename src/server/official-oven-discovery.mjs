import { loadOfficialOvenCatalog, officialOvenEntry } from "../ovens/official-oven-catalog.mjs";

export function createOfficialOvenDiscovery({ ovensDir, handlers, readOven }) {
  if (typeof readOven !== "function") throw new Error("Official Oven discovery requires a package reader.");
  const catalog = loadOfficialOvenCatalog({ ovensDir, handlers });

  function materialize(entry) {
    const oven = readOven(ovensDir, entry.id, true);
    if (!oven) throw new Error(`Official Oven ${entry.id} is unavailable.`);
    if (oven.id !== entry.id || oven.ir?.version !== entry.version || oven.ir?.contract !== entry.contract) {
      throw new Error(`Official Oven ${entry.id} changed after catalog validation.`);
    }
    return {
      ...oven,
      builtIn: true,
      origin: "official",
      catalogRevision: catalog.catalogRevision,
      catalogEntry: entry,
      repoKey: null,
      repoRoot: null,
    };
  }

  return Object.freeze({
    catalog,
    discover() {
      return catalog.entries.map(materialize);
    },
    find(id) {
      const entry = officialOvenEntry(catalog, id);
      return entry ? materialize(entry) : null;
    },
  });
}
