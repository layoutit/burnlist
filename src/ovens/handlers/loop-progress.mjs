import { registerOvenHandler } from "../oven-registry.mjs";
import { genericJsonHandler } from "./generic-json-handler.mjs";

registerOvenHandler("loop-progress", Object.freeze({
  ...genericJsonHandler,
  id: "loop-progress",
  dashboardEntries: undefined,
}));
