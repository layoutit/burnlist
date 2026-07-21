import { readTextFileWithLimit, safeStat } from "../../server/fs-safe.mjs";
import { OVEN_DATA_INPUT } from "../oven-registry.mjs";

export function validateGenericJsonData(payload) {
  return payload;
}

export const genericJsonHandler = Object.freeze({
  id: "checklist",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateGenericJsonData,

  serveData({ id, bindingPath, maxOvenDataBytes }) {
    if (!safeStat(bindingPath)?.isFile()) {
      throw Object.assign(new Error(`configured data for Oven ${id} is missing`), { status: 404 });
    }
    const payload = validateGenericJsonData(
      JSON.parse(readTextFileWithLimit(bindingPath, maxOvenDataBytes, `Oven ${id} data`)),
    );
    return { ovenId: id, path: bindingPath, payload, validated: false };
  },

  dashboardEntries({ id, discoverBurnlists }) {
    if (id !== "checklist") return [];
    return discoverBurnlists().map((entry) => ({
      ...entry,
      planPath: entry.planPath,
      ovenId: "checklist",
      ovenName: "Checklist",
      href: `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}`,
      progressLabel: `${entry.done}/${entry.total} done`,
    }));
  },
});
