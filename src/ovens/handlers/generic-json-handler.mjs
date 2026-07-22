import {
  readOvenJsonSnapshot,
  reconcileOvenJsonBindings,
  serveOvenJsonSnapshot,
} from "../../server/oven-json-handler.mjs";
import { OVEN_DATA_INPUT } from "../oven-registry.mjs";

export function validateGenericJsonData(payload) {
  return payload;
}

export const genericJsonHandler = Object.freeze({
  id: "checklist",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validateGenericJsonData,

  reconcileDataBindings(ctx) {
    reconcileOvenJsonBindings(ctx, ctx.id);
  },

  serveData(ctx) {
    reconcileOvenJsonBindings(ctx, ctx.id);
    const snapshot = readOvenJsonSnapshot(ctx, {
      ovenId: ctx.id,
      label: `configured data for Oven ${ctx.id}`,
      validate: validateGenericJsonData,
    });
    serveOvenJsonSnapshot(ctx, snapshot, {
      ovenId: ctx.id,
      path: ctx.bindingPath,
      validated: false,
    });
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
