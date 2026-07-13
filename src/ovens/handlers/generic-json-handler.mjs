import { readTextFileWithLimit, safeStat } from "../../server/fs-safe.mjs";

export const genericJsonHandler = Object.freeze({
  serveData({ id, bindingPath, maxOvenDataBytes }) {
    if (!safeStat(bindingPath)?.isFile()) {
      throw Object.assign(new Error(`configured data for Oven ${id} is missing`), { status: 404 });
    }
    const payload = JSON.parse(readTextFileWithLimit(bindingPath, maxOvenDataBytes, `Oven ${id} data`));
    return { ovenId: id, path: bindingPath, payload };
  },

  dashboardEntries({ oven, discoverBurnlists }) {
    if (oven.id !== "checklist") return [];
    return discoverBurnlists().map((entry) => ({
      ...entry,
      ovenId: "checklist",
      ovenName: "Checklist",
      href: `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}`,
      progressLabel: `${entry.done}/${entry.total} done`,
    }));
  },
});
