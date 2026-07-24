import { resolve } from "node:path";
import { rawSha256 } from "../dsl/hash.mjs";
import { localRecordPath, writeLocalRecord } from "../config/store.mjs";
import { canonicalCapabilityBytes, canonicalGrantBytes, capabilityRevision, validateCapability, validateCapabilityGrants } from "./contract.mjs";
import { readSnapshotBytes } from "./snapshot.mjs";

const keys = ["schema", "capability", "revision", "policyDigest", "grants", "grantsDigest"];
const id = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const revision = /^cp1-sha256:[a-f0-9]{64}$/u;
function fail(message, code = "ELOOP_CAPABILITY_TRUST") { throw Object.assign(new Error(`Loop capability trust: ${message}`), { code }); }
function exact(value, names) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name)); }
function target(repoRoot, capability) { if (!id.test(capability)) fail("invalid capability id"); return localRecordPath(repoRoot, "capabilities", capability); }
function canonical(record) { return Buffer.from(`${JSON.stringify({ schema: record.schema, capability: record.capability, revision: record.revision, policyDigest: record.policyDigest, grants: record.grants, grantsDigest: record.grantsDigest })}\n`, "utf8"); }
function validate(record, policy) {
  if (!exact(record, keys) || record.schema !== "burnlist-loop-capability-trust@1" || !id.test(record.capability) || !revision.test(record.revision) || !/^sha256:[a-f0-9]{64}$/u.test(record.policyDigest) || !/^sha256:[a-f0-9]{64}$/u.test(record.grantsDigest)) fail("record has invalid schema");
  const grants = validateCapabilityGrants(record.grants, policy); if (rawSha256(canonicalGrantBytes(grants, policy)) !== record.grantsDigest) fail("record grants digest mismatch");
  return { ...record, grants };
}
function privateFile(path, stat) { if (!stat || (stat.mode & 0o077) !== 0) fail(`record is not private: ${path}`); }
/** CLI-owned atomic trust record. A new explicit trust replaces only this capability's record. */
export function trustCapability({ repoRoot, capability, grants }) {
  const policy = validateCapability(capability); const narrowed = validateCapabilityGrants(grants, policy);
  const record = validate({ schema: "burnlist-loop-capability-trust@1", capability: policy.id, revision: capabilityRevision(policy), policyDigest: rawSha256(canonicalCapabilityBytes(policy)), grants: narrowed, grantsDigest: rawSha256(canonicalGrantBytes(narrowed, policy)) }, policy);
  try { return writeLocalRecord({ repoRoot, collection: "capabilities", name: policy.id, value: record, validate: (value) => validate(value, policy), replaceInvalidCodes: ["ELOOP_CAPABILITY"] }); }
  catch (error) {
    if (error?.code === "ELOOP_CONFIG" && /unsafe config directory/u.test(error.message)) fail(error.message.replace(/^Loop local config: unsafe config directory /u, "unsafe trust directory "));
    throw error;
  }
}

/** No-follow, bounded record read with ancestor and leaf identity checks. */
export function readTrustedCapability({ repoRoot, capability, policy }) {
  const path = target(repoRoot, capability); let read;
  try { read = readSnapshotBytes({ root: resolve(repoRoot), path, maximum: 65536 }); privateFile(path, read.identity); }
  catch (error) { if (error?.code === "ENOENT") fail(`capability ${capability} is untrusted`, "ELOOP_CAPABILITY_UNTRUSTED"); throw error; }
  let value; try { value = JSON.parse(read.bytes.toString("utf8")); } catch { fail("record is not JSON"); }
  const record = validate(value, policy); if (!canonical(record).equals(read.bytes)) fail("record is not canonical"); return record;
}
export function assertTrustedCapability({ repoRoot, resolved }) {
  let record; try { record = readTrustedCapability({ repoRoot, capability: resolved.policy.id, policy: resolved.policy }); }
  catch (error) { if (error?.code === "ELOOP_CAPABILITY") fail(`capability ${resolved.policy.id} changed after trust`, "ELOOP_CAPABILITY_CHANGED"); throw error; }
  if (record.revision !== resolved.revision || record.policyDigest !== rawSha256(resolved.bytes)) fail(`capability ${resolved.policy.id} changed after trust`, "ELOOP_CAPABILITY_CHANGED");
  return record;
}
