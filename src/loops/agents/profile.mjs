import { isAbsolute } from "node:path";
import { prefixed } from "../dsl/hash.mjs";

export const AGENT_PROFILE_SCHEMA = "burnlist-loop-agent-profile@1";
export const STAGE_ONE_ROUTES = Object.freeze(["implementation.standard", "review.strong"]);
export const CODEX_MODELS = Object.freeze(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.3-codex-spark"]);
export const REASONING_EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh", "max"]);

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const controls = /[\0\r\n]/u;
const guarantee = new Set(["enforced", "detected-at-boundaries", "supervised", "unsupported"]);
const requiredReviewerGuarantees = Object.freeze({ freshSession: "enforced", filesystemWriteDeny: "supervised" });

function fail(message, code = "ELOOP_AGENT_PROFILE") { throw Object.assign(new Error(`Loop agent: ${message}`), { code }); }
function exact(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function text(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > maximum || controls.test(value)) fail(`invalid ${label}`);
  return value;
}
function identity(value, label) {
  if (!exact(value, ["adapter", "binary", "model", "effort", "sandbox"])) fail(`invalid ${label} identity`);
  if (value.adapter !== "builtin:codex-cli" || !isAbsolute(text(value.binary, `${label} binary`)) || !CODEX_MODELS.includes(value.model) || !REASONING_EFFORTS.includes(value.effort) || !["workspace-write", "read-only"].includes(value.sandbox)) fail(`invalid ${label} identity`);
  return { adapter: value.adapter, binary: value.binary, model: value.model, effort: value.effort, sandbox: value.sandbox };
}
function guarantees(value) {
  const keys = ["freshSession", "filesystemWriteDeny", "foregroundHandle", "cancellation", "lifecycle", "usage"];
  if (!exact(value, keys) || keys.some((key) => key === "usage" ? !["reported", "unavailable"].includes(value[key]) : !guarantee.has(value[key]))) fail("invalid probe guarantees");
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
function validInvocation(requested, argv) {
  return Array.isArray(argv) && argv.length === 15
    && argv[0] === requested.binary && argv[1] === "exec" && argv[2] === "--json" && argv[3] === "--ephemeral"
    && argv[4] === "-m" && argv[5] === requested.model && argv[6] === "-c" && argv[7] === `model_reasoning_effort=${requested.effort}`
    && argv[8] === "-s" && argv[9] === requested.sandbox && argv[10] === "-C"
    && typeof argv[11] === "string" && isAbsolute(argv[11]) && !controls.test(argv[11])
    && argv[12] === "--skip-git-repo-check" && typeof argv[13] === "string" && argv[13] === "--"
    && typeof argv[14] === "string" && argv[14].length > 0 && Buffer.byteLength(argv[14]) <= 262144 && !argv[14].includes("\0");
}

/** Closed local profile. It requests an identity and authority but proves neither. */
export function validateAgentProfile(value) {
  const keys = ["schema", "id", "adapter", "binary", "model", "effort", "authority"];
  if (!exact(value, keys) || value.schema !== AGENT_PROFILE_SCHEMA || !slug.test(value.id)) fail("invalid profile");
  if (value.adapter !== "builtin:codex-cli" || !isAbsolute(text(value.binary, "binary")) || !["read", "write"].includes(value.authority)) fail("invalid profile");
  if (!CODEX_MODELS.includes(value.model)) fail(`model must be one of: ${CODEX_MODELS.join(", ")}`);
  if (!REASONING_EFFORTS.includes(value.effort)) fail(`effort must be one of: ${REASONING_EFFORTS.join(", ")}`);
  return Object.freeze({ schema: value.schema, id: value.id, adapter: value.adapter, binary: value.binary, model: value.model, effort: value.effort, authority: value.authority });
}

/** Provider statements and host-observed invocation evidence remain separate. */
export function validateCodexProbe(value) {
  if (!exact(value, ["schema", "requested", "providerReported", "technicallyProven", "guarantees"]) || value.schema !== "burnlist-codex-probe@1") fail("invalid Codex probe");
  const requested = identity(value.requested, "requested");
  if (!exact(value.providerReported, ["model", "sessionId", "version"]) || typeof value.providerReported.sessionId !== "string" || !value.providerReported.sessionId || [value.providerReported.model, value.providerReported.version].some((item) => item !== null && typeof item !== "string") || [value.providerReported.sessionId, value.providerReported.model, value.providerReported.version].filter((item) => item !== null).some((item) => !item || Buffer.byteLength(item) > 512 || controls.test(item))) fail("invalid provider-reported identity");
  if (!exact(value.technicallyProven, ["argv", "pidObserved"]) || value.technicallyProven.pidObserved !== true || !validInvocation(requested, value.technicallyProven.argv)) fail("invalid technically-proven identity");
  return Object.freeze({
    schema: value.schema,
    requested,
    providerReported: { model: value.providerReported.model, sessionId: value.providerReported.sessionId, version: value.providerReported.version },
    technicallyProven: { argv: [...value.technicallyProven.argv], pidObserved: true },
    guarantees: guarantees(value.guarantees),
  });
}

export function requestedCodexIdentity(profile) {
  const current = validateAgentProfile(profile);
  return Object.freeze({ adapter: current.adapter, binary: current.binary, model: current.model, effort: current.effort, sandbox: current.authority === "write" ? "workspace-write" : "read-only" });
}
export function agentProfileRevision(profile) {
  const current = validateAgentProfile(profile);
  return prefixed("ap1-sha256:", "agent-profile-v1", [Buffer.from(`${JSON.stringify(current)}\n`)]);
}
function sameIdentity(left, right) { return left.adapter === right.adapter && left.binary === right.binary && left.model === right.model && left.effort === right.effort && left.sandbox === right.sandbox; }
function routeMap(value) {
  if (!exact(value, STAGE_ONE_ROUTES)) fail("Stage 1 routes must be closed");
  for (const route of STAGE_ONE_ROUTES) if (!slug.test(value[route])) fail(`invalid ${route} route`);
  return value;
}

/** Resolve M1 configuration authority without launching or probing an agent. */
export function resolveConfiguredStageOneRoutes({ profiles, routes }) {
  if (!Array.isArray(profiles) || profiles.length < 2 || profiles.length > 32) fail("invalid profiles");
  const byId = new Map();
  for (const profile of profiles.map(validateAgentProfile)) {
    if (byId.has(profile.id)) fail("duplicate profile id");
    byId.set(profile.id, profile);
  }
  const mapped = routeMap(routes);
  if (mapped["implementation.standard"] === mapped["review.strong"]) fail("implementation and review require distinct profile ids", "ELOOP_REVIEWER_ISOLATION");
  const resolveRoute = (route, authority) => {
    const profile = byId.get(mapped[route]);
    if (!profile) fail(`route ${route} references an unknown profile`);
    if (profile.authority !== authority) fail(`route ${route} requires ${authority} authority`);
    return Object.freeze({ route, profile, authority: profile.authority });
  };
  const implementation = resolveRoute("implementation.standard", "write");
  const review = resolveRoute("review.strong", "read");
  return Object.freeze({
    implementation: Object.freeze({ ...implementation, guarantees: Object.freeze({}) }),
    review: Object.freeze({ ...review, guarantees: Object.freeze({ freshSession: "enforced", filesystemWriteDeny: "supervised" }) }),
  });
}

/** Bind only the two Stage 1 routes; hard reviewer guarantees never downgrade. */
export function resolveStageOneRoutes({ profiles, routes, probes }) {
  if (!Array.isArray(profiles) || profiles.length < 2 || profiles.length > 32) fail("invalid profiles");
  const byId = new Map();
  for (const profile of profiles.map(validateAgentProfile)) {
    if (byId.has(profile.id)) fail("duplicate profile id");
    byId.set(profile.id, profile);
  }
  const mapped = routeMap(routes);
  if (!probes || typeof probes !== "object" || Array.isArray(probes)) fail("invalid probe map");
  const resolveRoute = (route, authority) => {
    const profile = byId.get(mapped[route]);
    if (!profile) fail(`route ${route} references an unknown profile`);
    if (profile.authority !== authority) fail(`route ${route} requires ${authority} authority`);
    const probe = validateCodexProbe(probes[profile.id]); const requested = requestedCodexIdentity(profile);
    if (!sameIdentity(probe.requested, requested) || probe.providerReported.model !== null && probe.providerReported.model !== requested.model) fail(`probe does not bind profile ${profile.id}`);
    return Object.freeze({ route, profile, requested, providerReported: probe.providerReported, technicallyProven: probe.technicallyProven, guarantees: probe.guarantees });
  };
  const implementation = resolveRoute("implementation.standard", "write");
  const review = resolveRoute("review.strong", "read");
  if (implementation.profile.id === review.profile.id || implementation.providerReported.sessionId === review.providerReported.sessionId) fail("implementation and review require independent provider sessions", "ELOOP_REVIEWER_ISOLATION");
  for (const [name, expected] of Object.entries(requiredReviewerGuarantees))
    if (review.guarantees[name] !== expected) fail(`review route lacks ${expected} ${name}`, "ELOOP_REVIEWER_ISOLATION");
  return Object.freeze({ implementation, review });
}
