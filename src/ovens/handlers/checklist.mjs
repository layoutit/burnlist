import { registerOvenHandler } from "../oven-registry.mjs";
import { genericJsonHandler } from "./generic-json-handler.mjs";

registerOvenHandler("checklist", genericJsonHandler);
