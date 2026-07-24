import { spawn as nodeSpawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { parse, resolve } from "node:path";
import { rawSha256 } from "../dsl/hash.mjs";
import { GUARANTEE_LABELS, readCapabilityCatalog, resolveCapability } from "./contract.mjs";
import { checkSnapshot, repoTarget, snapshotTarget } from "./snapshot.mjs";
import { assertTrustedCapability } from "./trust.mjs";

function fail(message, code = "ELOOP_CAPABILITY_LAUNCH") { throw Object.assign(new Error(`Loop capability launch: ${message}`), { code }); }
function candidate(value) { if (typeof value !== "string" || !/^cm1-sha256:[a-f0-9]{64}$/u.test(value)) fail("candidate must be a canonical digest"); return value; }
function cleanEnvironment(policy) { const environment = {}; for (const name of policy.environment.inherit) if (Object.hasOwn(process.env, name)) environment[name] = process.env[name]; return Object.assign(environment, policy.environment.set); }
function launchSnapshots(repoRoot, policy) {
  const cwd = repoTarget(repoRoot, policy.cwd); const snapshots = [snapshotTarget({ root: repoRoot, path: cwd, kind: "directory" })];
  // Executables may live outside the repository. Start at their filesystem
  // root so a symlink anywhere in the absolute ancestry is rejected.
  snapshots.push(snapshotTarget({ root: parse(policy.argv[0]).root, path: policy.argv[0], kind: "file" }));
  for (const path of [...policy.filesystem.read, ...policy.filesystem.write]) { const target = repoTarget(repoRoot, path); const entry = lstatSync(target); snapshots.push(snapshotTarget({ root: repoRoot, path: target, kind: entry.isDirectory() ? "directory" : "file" })); }
  return { cwd, snapshots };
}
function assertSnapshots(snapshots) { for (const snapshot of snapshots) checkSnapshot(snapshot); }
function aggregateCapture(child, maximum) {
  const chunks = { stdout: [], stderr: [] }; let total = 0; let truncated = false; let killed = false;
  const terminate = () => { if (!killed) { killed = true; try { child.kill("SIGTERM"); } catch { /* direct process may already be gone */ } } };
  for (const name of ["stdout", "stderr"]) child[name]?.on("data", (chunk) => {
    const bytes = Buffer.from(chunk); const remaining = Math.max(0, maximum - total); if (remaining) { chunks[name].push(bytes.subarray(0, remaining)); total += Math.min(remaining, bytes.length); }
    if (bytes.length > remaining) { truncated = true; terminate(); }
  });
  return { result() { return { stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr), total, truncated }; }, terminate };
}

export function preflightCapability({ repoRoot, capabilityId }) {
  const root = resolve(repoRoot); const catalog = readCapabilityCatalog(root); const resolved = resolveCapability(catalog, capabilityId); const trust = assertTrustedCapability({ repoRoot: root, resolved });
  const policy = trust.grants; const launch = launchSnapshots(root, policy);
  return { repoRoot: root, capabilityId, revision: resolved.revision, policyBytes: resolved.bytes, policy, grantsDigest: trust.grantsDigest, launch };
}
export function revalidateCapability(preflight) {
  assertSnapshots(preflight.launch.snapshots);
  const fresh = preflightCapability({ repoRoot: preflight.repoRoot, capabilityId: preflight.capabilityId });
  if (fresh.revision !== preflight.revision || !fresh.policyBytes.equals(preflight.policyBytes) || fresh.grantsDigest !== preflight.grantsDigest) fail("capability changed after preflight", "ELOOP_CAPABILITY_CHANGED");
  assertSnapshots(fresh.launch.snapshots); return fresh;
}

/** Executes a verified direct process only. Child/descendant containment is explicitly unsupported. */
export function runTrustedCapability({ repoRoot, capabilityId, inputCandidate, preflight, spawn = nodeSpawn }) {
  const current = revalidateCapability(preflight ?? preflightCapability({ repoRoot, capabilityId })); const input = candidate(inputCandidate); const [command, ...args] = current.policy.argv;
  let child; try { child = spawn(command, args, { cwd: current.launch.cwd, env: cleanEnvironment(current.policy), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); } catch (error) { return Promise.reject(error); }
  const capture = aggregateCapture(child, current.policy.output.maxBytes); let timedOut = false; let forceTimer;
  const deadline = setTimeout(() => { timedOut = true; capture.terminate(); forceTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already exited */ } }, 100); }, current.policy.maxMilliseconds);
  return new Promise((resolveResult, reject) => {
    child.once("error", (error) => { clearTimeout(deadline); clearTimeout(forceTimer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(deadline); clearTimeout(forceTimer); const captured = capture.result(); const evidence = Buffer.concat([Buffer.from(`candidate=${input}\nstdout-bytes=${captured.stdout.length}\n`, "utf8"), captured.stdout, Buffer.from(`\nstderr-bytes=${captured.stderr.length}\n`, "utf8"), captured.stderr]);
      const result = { schema: "capability-evidence@1", capability: capabilityId, capabilityRevision: current.revision, inputCandidate: input, outcome: code === 0 && !signal && !captured.truncated && !timedOut ? "pass" : "fail", exitCode: Number.isInteger(code) ? code : null, truncated: captured.truncated, timedOut, evidenceDigest: rawSha256(evidence), evidenceBytes: evidence.length, guaranteeLabels: GUARANTEE_LABELS };
      resolveResult({ result: Object.freeze(result), evidence: Buffer.from(evidence) });
    });
  });
}

export function validateCapabilityEvidence(value) {
  const keys = ["schema", "capability", "capabilityRevision", "inputCandidate", "outcome", "exitCode", "truncated", "timedOut", "evidenceDigest", "evidenceBytes", "guaranteeLabels"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key)) || value.schema !== "capability-evidence@1" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.capability) || !/^cp1-sha256:[a-f0-9]{64}$/u.test(value.capabilityRevision) || !/^cm1-sha256:[a-f0-9]{64}$/u.test(value.inputCandidate) || !["pass", "fail"].includes(value.outcome) || !(Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255 || value.exitCode === null) || typeof value.truncated !== "boolean" || typeof value.timedOut !== "boolean" || !/^sha256:[a-f0-9]{64}$/u.test(value.evidenceDigest) || !Number.isSafeInteger(value.evidenceBytes) || value.evidenceBytes < 0 || JSON.stringify(value.guaranteeLabels) !== JSON.stringify(GUARANTEE_LABELS)) fail("invalid capability evidence");
  if (value.outcome === "pass" && (value.exitCode !== 0 || value.truncated || value.timedOut)) fail("invalid passing evidence"); return value;
}
