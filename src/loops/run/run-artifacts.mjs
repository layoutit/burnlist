import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { prefixed, rawSha256 } from "../dsl/hash.mjs";
import { validateDispatchAuthority } from "../contracts/agent-result.mjs";
import { parseBoundedObject } from "../contracts/contract.mjs";
import { resolveConfiguredStageOneRoutes, validateAgentProfile, agentProfileRevision } from "../agents/profile.mjs";
import { canonicalCapabilityBytes, canonicalGrantBytes, capabilityRevision, GUARANTEE_LABELS,
  validateCapability, validateCapabilityGrants } from "../capabilities/contract.mjs";

const PROFILE = /^ap1-sha256:[a-f0-9]{64}$/u;
const RAW = /^sha256:[a-f0-9]{64}$/u;
const RECIPE = /^er1-sha256:[a-f0-9]{64}$/u;
const POLICY_KEYS = ["schema", "recipeRevision", "routes", "capabilities"];
const ROUTE_KEYS = ["route", "profile", "profileRevision", "executableDigest", "guarantees"];
const CAPABILITY_KEYS = ["id", "policy", "revision", "policyDigest", "grants", "grantsDigest", "trust", "guarantees"];

function fail(message) { throw Object.assign(new Error(`Loop bound policy: ${message}`), { code: "ELOOP_BOUND_POLICY" }); }
function closed(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function sortedUnique(values, key) { return values.every((value, index) => index === 0 || Buffer.compare(Buffer.from(values[index - 1][key]), Buffer.from(value[key])) < 0); }
const canonical = (value) => Buffer.from(`${JSON.stringify(value)}\n`);

export function validateBoundPolicy(value) {
  if (!closed(value, POLICY_KEYS) || value.schema !== "burnlist-loop-bound-policy@1" || !RECIPE.test(value.recipeRevision)
    || !Array.isArray(value.routes) || value.routes.length !== 2 || !Array.isArray(value.capabilities) || value.capabilities.length !== 1) fail("invalid closed policy");
  const routes = value.routes.map((entry) => {
    if (!closed(entry, ROUTE_KEYS) || !["implementation.standard", "review.strong"].includes(entry.route)
      || !PROFILE.test(entry.profileRevision) || !RAW.test(entry.executableDigest)
      || !closed(entry.guarantees, entry.route === "review.strong"
        ? ["freshSession", "filesystemWriteDeny"] : ["freshSession"])) fail("invalid route binding");
    const profile = validateAgentProfile(entry.profile), profileRevision = agentProfileRevision(profile);
    if (entry.profileRevision !== profileRevision || entry.guarantees.freshSession !== "enforced"
      || entry.route === "review.strong" && entry.guarantees.filesystemWriteDeny !== "supervised") fail("route revision or guarantee mismatch");
    return { route: entry.route, profile, profileRevision, executableDigest: entry.executableDigest,
      guarantees: { ...entry.guarantees } };
  });
  if (!sortedUnique(routes, "route")) fail("invalid route set");
  resolveConfiguredStageOneRoutes({ profiles: routes.map((entry) => entry.profile),
    routes: Object.fromEntries(routes.map((entry) => [entry.route, entry.profile.id])) });
  const capabilities = value.capabilities.map((entry) => {
    if (!closed(entry, CAPABILITY_KEYS) || entry.id !== "repo-verify" || !RAW.test(entry.policyDigest) || !RAW.test(entry.grantsDigest)
      || JSON.stringify(entry.guarantees) !== JSON.stringify(GUARANTEE_LABELS)) fail("invalid capability binding");
    const policy = validateCapability(entry.policy), grants = validateCapabilityGrants(entry.grants, policy);
    if (policy.id !== entry.id || entry.revision !== capabilityRevision(policy)
      || entry.policyDigest !== rawSha256(canonicalCapabilityBytes(policy)) || entry.grantsDigest !== rawSha256(canonicalGrantBytes(grants, policy))
      || !closed(entry.trust, ["schema", "capability", "revision", "policyDigest", "grants", "grantsDigest"])
      || entry.trust.schema !== "burnlist-loop-capability-trust@1" || entry.trust.capability !== entry.id
      || entry.trust.revision !== entry.revision || entry.trust.policyDigest !== entry.policyDigest
      || entry.trust.grantsDigest !== entry.grantsDigest || JSON.stringify(entry.trust.grants) !== JSON.stringify(grants)) fail("capability policy or trust mismatch");
    return { id: entry.id, policy, revision: entry.revision, policyDigest: entry.policyDigest, grants,
      grantsDigest: entry.grantsDigest, trust: { schema: entry.trust.schema, capability: entry.trust.capability,
        revision: entry.trust.revision, policyDigest: entry.trust.policyDigest, grants, grantsDigest: entry.trust.grantsDigest },
      guarantees: Object.fromEntries(Object.keys(GUARANTEE_LABELS).map((key) => [key, GUARANTEE_LABELS[key]])) };
  });
  if (!sortedUnique(capabilities, "id") || capabilities[0]?.id !== "repo-verify") fail("invalid capability set");
  return Object.freeze({ schema: value.schema, recipeRevision: value.recipeRevision, routes: Object.freeze(routes), capabilities: Object.freeze(capabilities) });
}

export function canonicalBoundPolicyBytes(value) { return Buffer.from(`${JSON.stringify(validateBoundPolicy(value))}\n`, "utf8"); }
export function boundPolicyRevision(value) { const bytes = canonicalBoundPolicyBytes(value); return prefixed("bp1-sha256:", "bound-policy-v1", [bytes]); }
export function loadBoundPolicy(bytes) {
  const raw = Buffer.from(bytes), value = parseBoundedObject(raw, { maximumBytes: 262_144, maximumDepth: 8, label: "bound policy" });
  const policy = validateBoundPolicy(value), canonical = canonicalBoundPolicyBytes(policy);
  if (!canonical.equals(raw)) fail("policy is not canonical");
  return Object.freeze({ policy, bytes: raw, revision: boundPolicyRevision(policy) });
}

const ROLE = /^(?:recipe|policy|instruction:[a-z0-9]+(?:-[a-z0-9]+)*|dispatch:iv1-sha256:[a-f0-9]{64}|output:iv1-sha256:[a-f0-9]{64}:[a-f0-9]{16})$/u;
export function validateArtifactRole(role) { if (typeof role !== "string" || !ROLE.test(role)) throw Object.assign(new Error("Loop artifact: invalid role"), { code: "ELOOP_ARTIFACT" }); return role; }

export function validateArtifactBytes({ role, bytes, recipe, policy, run }) {
  const raw = Buffer.from(bytes); validateArtifactRole(role);
  if (role === "recipe") {
    const frozenRecipe = loadFrozenRecipe(raw);
    return { schema: "burnlist-loop-frozen@1", mediaType: "application/json", revision: frozenRecipe.revisions.executable, value: frozenRecipe };
  }
  if (role === "policy") {
    const loaded = loadBoundPolicy(raw);
    if (recipe && loaded.policy.recipeRevision !== recipe.revisions.executable) fail("policy recipe binding mismatch");
    return { schema: "burnlist-loop-bound-policy@1", mediaType: "application/json", revision: loaded.revision, value: loaded.policy };
  }
  if (role.startsWith("instruction:")) {
    const id = role.slice("instruction:".length), expected = recipe?.instructions?.find((entry) => entry.id === id);
    if (!expected || rawSha256(raw) !== expected.digest) throw Object.assign(new Error("Loop artifact: instruction does not match frozen recipe"), { code: "ELOOP_ARTIFACT" });
    return { schema: "burnlist-loop-instruction@1", mediaType: "text/markdown", revision: expected.digest, value: raw };
  }
  if (role.startsWith("output:")) return { schema: "burnlist-loop-output-chunk@1", mediaType: "application/octet-stream", revision: rawSha256(raw), value: raw };
  const dispatch = validateDispatchAuthority(raw);
  if (role !== `dispatch:${dispatch.value.invocationId}` || recipe && dispatch.value.recipeRevision !== recipe.revisions.executable
    || policy && dispatch.value.policyRevision !== boundPolicyRevision(policy)
    || run && (dispatch.value.runId !== run.runId || dispatch.value.assignmentId !== run.assignmentId
      || dispatch.value.itemRevision !== run.itemRevision || !run.ownerClaim
      || dispatch.value.claimId !== run.ownerClaim.claimId || dispatch.value.nodeId !== run.ownerClaim.nodeId
      || dispatch.value.attempt !== run.ownerClaim.attempt || dispatch.value.inputCandidate !== run.ownerClaim.inputCandidate))
    throw Object.assign(new Error("Loop artifact: dispatch authority binding mismatch"), { code: "ELOOP_ARTIFACT" });
  return { schema: "burnlist-loop-dispatch-authority@1", mediaType: "application/json", revision: dispatch.digest, value: dispatch.value };
}
