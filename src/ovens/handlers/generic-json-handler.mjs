import {
  createOvenJsonResponse,
  readOvenJsonSnapshot,
  reconcileOvenJsonBindings,
  serveOvenJsonSnapshot,
  serializeOvenJsonProjection,
  serveOvenJsonResponse,
} from "../../server/oven-json-handler.mjs";
import { OVEN_DATA_INPUT } from "../oven-registry.mjs";

export function validateGenericJsonData(payload) {
  return payload;
}

function terminalVisualParityPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.byDomain) return payload;
  const byDomain = Object.fromEntries(Object.entries(payload.byDomain).map(([id, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.frames)) return [id, value];
    return [id, {
      ...value,
      frames: value.frames.map((frame) => {
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) return frame;
        const { tiles: _tiles, ...retained } = frame;
        return retained;
      }),
    }];
  }));
  return {
    ...(payload.schema !== undefined ? { schema: payload.schema } : {}),
    ...(payload.initialDomainId !== undefined ? { initialDomainId: payload.initialDomainId } : {}),
    ...(payload.domains !== undefined ? { domains: payload.domains } : {}),
    ...(payload.verdict !== undefined ? { verdict: payload.verdict } : {}),
    byDomain,
  };
}

export const genericJsonHandler = Object.freeze({
  id: "checklist",
  inputContract: "checklist-progress@1",
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
    if (ctx.oven?.ir?.contract === "burnlist-visual-parity-data@1" && ctx.url.searchParams.get("terminal") === "1") {
      const payload = serializeOvenJsonProjection(ctx, snapshot, terminalVisualParityPayload(snapshot.payload));
      const response = createOvenJsonResponse(ctx, payload, {
        ovenId: ctx.id,
        path: ctx.bindingPath,
        validated: false,
      });
      serveOvenJsonResponse(ctx, response);
      return;
    }
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
