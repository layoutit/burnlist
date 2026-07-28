import { loadOfficialOvenCatalog, officialOvenEntry } from "../ovens/official-oven-catalog.mjs";

export function createOfficialOvenDiscovery({ ovensDir, handlers, readOven }) {
  if (typeof readOven !== "function") throw new Error("Official Oven discovery requires a package reader.");
  const catalog = loadOfficialOvenCatalog({ ovensDir, handlers });
  const materialized = new Map();

  function materialize(entry) {
    const cached = materialized.get(entry.id);
    if (cached) return cached;
    const oven = readOven(ovensDir, entry.id, true);
    if (!oven) throw new Error(`Official Oven ${entry.id} is unavailable.`);
    if (oven.id !== entry.id || oven.ir?.version !== entry.version || oven.ir?.contract !== entry.renderContract) {
      throw new Error(`Official Oven ${entry.id} changed after catalog validation.`);
    }
    const resolved = Object.freeze({
      ...oven,
      builtIn: true,
      origin: "official",
      catalogRevision: catalog.catalogRevision,
      catalogEntry: entry,
      repoKey: null,
      repoRoot: null,
    });
    materialized.set(entry.id, resolved);
    return resolved;
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
