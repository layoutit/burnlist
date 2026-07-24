import { isClosedObject, readLocalRecord, writeLocalRecord } from "./store.mjs";
import { CODEX_MODELS, REASONING_EFFORTS, validateAgentProfile } from "../agents/profile.mjs";
import { parse } from "node:path";
import { snapshotTarget } from "../capabilities/snapshot.mjs";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const route = /^(?:implementation\.standard|review\.strong)$/u;
const ROUTE_KEYS = ["schema", "route", "profile"];

function fail(message) { throw Object.assign(new Error(`Loop profile: ${message}`), { code: "ELOOP_PROFILE" }); }
function profileName(value, label = "profile slug") { if (typeof value !== "string" || !slug.test(value)) fail(`invalid ${label}`); return value; }

export function validateProfile(value) {
  try { return validateAgentProfile(value); } catch (error) { fail(error.message.replace(/^Loop agent: /u, "")); }
}

export function validateRoute(value) {
  if (!isClosedObject(value, ROUTE_KEYS) || value.schema !== "burnlist-loop-route@1" || !route.test(value.route)) fail("route record has invalid schema");
  return { schema: value.schema, route: value.route, profile: profileName(value.profile) };
}

export function saveProfile({ repoRoot, slug: name, adapter, binary, model, effort, authority }) {
  const value = { schema: "burnlist-loop-agent-profile@1", id: name, adapter, binary, model, effort, authority };
  return writeLocalRecord({ repoRoot, collection: "profiles", name: profileName(name), value, validate: validateProfile });
}
export function readProfile({ repoRoot, slug: name }) { return readLocalRecord({ repoRoot, collection: "profiles", name: profileName(name), validate: validateProfile }); }
export function saveRoute({ repoRoot, route: name, profile }) {
  const value = { schema: "burnlist-loop-route@1", route: name, profile };
  return writeLocalRecord({ repoRoot, collection: "routes", name: String(name).replace(".", "-"), value, validate: validateRoute });
}
export function readRoute({ repoRoot, route: name }) { if (!route.test(name)) fail("unknown route"); return readLocalRecord({ repoRoot, collection: "routes", name: name.replace(".", "-"), validate: validateRoute }); }

/**
 * No-cost local inspection only: no model invocation, child process, or write.
 * Availability is not technical proof and therefore never makes setup ready.
 */
export function doctorProfile({ repoRoot, slug: name }) {
  const profile = readProfile({ repoRoot, slug: name });
  try {
    const snapshot = snapshotTarget({ root: parse(profile.binary).root, path: profile.binary, maximum: 64 * 1024 * 1024 });
    if ((snapshot.identity.mode & 0o111) === 0) return { available: false, ready: false, profile, reason: "binary is not executable" };
    return { available: true, ready: false, profile, executableDigest: snapshot.digest, reason: "technical guarantees are unavailable; no model probe was run" };
  } catch (error) { return { available: false, ready: false, profile, reason: error?.message || "binary inspection failed" }; }
}

export const requiredRoutes = Object.freeze([
  { route: "implementation.standard", authority: "write" },
  { route: "review.strong", authority: "read" },
]);
export { CODEX_MODELS, REASONING_EFFORTS };
