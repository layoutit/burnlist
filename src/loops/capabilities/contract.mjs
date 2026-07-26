import { join, resolve } from "node:path";
import { prefixed, rawSha256 } from "../dsl/hash.mjs";
import { readSnapshotBytes } from "./snapshot.mjs";

export const CAPABILITY_CATALOG = ".burnlist/loop-capabilities.json";
export const CAPABILITY_SCHEMA = "burnlist-loop-capabilities@1";
export const MAX_CATALOG_BYTES = 262144;
export const GUARANTEE_LABELS = Object.freeze({ filesystem: "unsupported", process: "supervised", network: "unsupported", environment: "supervised", credentials: "unsupported", childSpawn: "unsupported", descendantContainment: "unsupported" });
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const envName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const repoPath = /^(?!\.git(?:\/|$))(?!\.local\/burnlist\/loop(?:\/|$))(?!.*(?:^|\/)\.\.?($|\/))[\x21-\x7e]+$/u;
const policyKeys = ["id", "argv", "cwd", "environment", "network", "filesystem", "output", "maxMilliseconds"];
const grantKeys = ["argv", "cwd", "environment", "network", "filesystem", "output", "maxMilliseconds"];

function exact(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function fail(message, code = "ELOOP_CAPABILITY") { throw Object.assign(new Error(`Loop capability: ${message}`), { code }); }
function safeText(value, label, { empty = false, maximum = 4096 } = {}) { if (typeof value !== "string" || (!empty && !value) || Buffer.byteLength(value) > maximum || /[\0\r\n]/u.test(value)) fail(`invalid ${label}`); return value; }
function sortedUnique(values, valid, label, maximum = 128) {
  if (!Array.isArray(values) || values.length > maximum || values.some((value) => typeof value !== "string" || !valid(value))) fail(`invalid ${label}`);
  if (new Set(values).size !== values.length || values.some((value, index) => index && Buffer.compare(Buffer.from(values[index - 1]), Buffer.from(value)) >= 0)) fail(`${label} must be sorted and unique`);
  return values;
}
function env(value) {
  if (!exact(value, ["inherit", "set"])) fail("environment must be closed");
  sortedUnique(value.inherit, (name) => envName.test(name), "environment inherit", 64);
  if (!value.inherit.includes("PATH")) fail("environment inherit must include PATH explicitly");
  if (!value.set || typeof value.set !== "object" || Array.isArray(value.set) || Object.keys(value.set).length > 64) fail("invalid environment set");
  const names = Object.keys(value.set);
  if (names.some((name) => !envName.test(name) || value.inherit.includes(name)) || names.some((name) => !safeText(value.set[name], `environment ${name}`, { empty: true }))) fail("invalid environment set");
  return { inherit: [...value.inherit], set: Object.fromEntries(names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((name) => [name, value.set[name]])) };
}
function paths(value, label) { return sortedUnique(value, (path) => path === "." || repoPath.test(path), label, 256); }
function canonical(value, keys) { return Object.fromEntries(keys.map((key) => [key, value[key]])); }

/** A capability is declarative policy, not a command recipe. */
export function validateCapability(policy) {
  if (!exact(policy, policyKeys) || !slug.test(policy.id)) fail("invalid capability policy");
  if (!Array.isArray(policy.argv) || policy.argv.length < 1 || policy.argv.length > 64) fail("argv must be a nonempty bounded array");
  for (const [index, value] of policy.argv.entries()) { safeText(value, `argv[${index}]`); if (index === 0 && !value.startsWith("/")) fail("argv[0] must be an absolute executable path"); }
  if (typeof policy.cwd !== "string" || (policy.cwd !== "." && !repoPath.test(policy.cwd))) fail("cwd must be a safe repository path");
  const environment = env(policy.environment);
  if (!["deny", "allow"].includes(policy.network)) fail("network must be deny or allow");
  if (!exact(policy.filesystem, ["read", "write"])) fail("filesystem must be closed");
  const filesystem = { read: paths(policy.filesystem.read, "filesystem read"), write: paths(policy.filesystem.write, "filesystem write") };
  if (filesystem.write.some((path) => path === "." || filesystem.read.includes(path))) fail("invalid filesystem grants");
  if (!exact(policy.output, ["maxBytes"]) || !Number.isSafeInteger(policy.output.maxBytes) || policy.output.maxBytes < 1 || policy.output.maxBytes > 1048576) fail("invalid output limit");
  if (!Number.isSafeInteger(policy.maxMilliseconds) || policy.maxMilliseconds < 1 || policy.maxMilliseconds > 86400000) fail("invalid maxMilliseconds");
  return { id: policy.id, argv: [...policy.argv], cwd: policy.cwd, environment, network: policy.network, filesystem, output: { maxBytes: policy.output.maxBytes }, maxMilliseconds: policy.maxMilliseconds };
}
export function canonicalCapabilityBytes(policy) { return Buffer.from(`${JSON.stringify(validateCapability(policy))}\n`, "utf8"); }
export function capabilityRevision(policy) { return prefixed("cp1-sha256:", "capability-v1", [canonicalCapabilityBytes(policy)]); }

/** Local grants are a separate closed object and can only narrow the repository policy. */
export function validateCapabilityGrants(grants, policy) {
  const source = validateCapability(policy);
  if (!exact(grants, grantKeys) || JSON.stringify(grants.argv) !== JSON.stringify(source.argv) || grants.cwd !== source.cwd) fail("grants must preserve exact argv and cwd");
  const narrowed = { ...source, environment: env(grants.environment), network: grants.network, filesystem: { read: paths(grants.filesystem?.read, "grant filesystem read"), write: paths(grants.filesystem?.write, "grant filesystem write") }, output: grants.output, maxMilliseconds: grants.maxMilliseconds };
  if (!narrowed.environment.inherit.every((name) => source.environment.inherit.includes(name)) || Object.entries(narrowed.environment.set).some(([name, value]) => source.environment.set[name] !== value)) fail("environment grant exceeds policy");
  if (source.network === "deny" && narrowed.network !== "deny" || !["deny", "allow"].includes(narrowed.network)) fail("network grant exceeds policy");
  if (!narrowed.filesystem.read.every((path) => source.filesystem.read.includes(path)) || !narrowed.filesystem.write.every((path) => source.filesystem.write.includes(path))) fail("filesystem grant exceeds policy");
  if (!exact(narrowed.output, ["maxBytes"]) || !Number.isSafeInteger(narrowed.output.maxBytes) || narrowed.output.maxBytes < 1 || narrowed.output.maxBytes > source.output.maxBytes || !Number.isSafeInteger(narrowed.maxMilliseconds) || narrowed.maxMilliseconds < 1 || narrowed.maxMilliseconds > source.maxMilliseconds) fail("resource grant exceeds policy");
  return canonical(narrowed, policyKeys.slice(1));
}
export function canonicalGrantBytes(grants, policy) { return Buffer.from(`${JSON.stringify(validateCapabilityGrants(grants, policy))}\n`, "utf8"); }

export function parseCapabilityCatalog(bytes) {
  let value; try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { fail("catalog is not valid JSON"); }
  if (!exact(value, ["schema", "capabilities"]) || value.schema !== CAPABILITY_SCHEMA || !Array.isArray(value.capabilities) || value.capabilities.length > 64) fail("catalog has an invalid schema");
  const capabilities = value.capabilities.map(validateCapability);
  if (new Set(capabilities.map((policy) => policy.id)).size !== capabilities.length || capabilities.some((policy, index) => index && Buffer.compare(Buffer.from(capabilities[index - 1].id), Buffer.from(policy.id)) >= 0)) fail("capabilities must be sorted with unique ids");
  return { schema: CAPABILITY_SCHEMA, capabilities, bytes: Buffer.from(bytes), digest: rawSha256(bytes) };
}
/** The source file and every existing ancestor are no-follow descriptor-checked. */
export function readCapabilityCatalog(repoRoot) { const root = resolve(repoRoot); const path = join(root, CAPABILITY_CATALOG); const { bytes } = readSnapshotBytes({ root, path, maximum: MAX_CATALOG_BYTES }); return { ...parseCapabilityCatalog(bytes), path }; }
export function resolveCapability(catalog, id) { if (!slug.test(id)) fail("invalid capability id"); const policy = catalog?.capabilities?.find((entry) => entry.id === id); if (!policy) fail(`unknown capability ${id}`, "ELOOP_CAPABILITY_UNKNOWN"); return { policy, revision: capabilityRevision(policy), bytes: canonicalCapabilityBytes(policy) }; }
export function bindCapabilitySymbols(ir, catalog) { if (!ir || !Array.isArray(ir.nodes)) fail("invalid compiler IR"); return ir.nodes.filter((node) => node.kind === "check").map((node) => ({ nodeId: node.id, capability: node.capability, revision: resolveCapability(catalog, node.capability).revision })); }
