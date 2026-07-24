import assert from "node:assert/strict";
import test from "node:test";
import { requestedCodexIdentity, resolveConfiguredStageOneRoutes, validateAgentProfile, validateCodexProbe } from "./profile.mjs";

const profile = { schema: "burnlist-loop-agent-profile@1", id: "reviewer", adapter: "builtin:codex-cli", binary: "/usr/local/bin/codex", model: "gpt-5.6-sol", effort: "medium", authority: "read" };
const requested = requestedCodexIdentity(profile);
const argv = [profile.binary, "exec", "--json", "--ephemeral", "-m", profile.model, "-c", "model_reasoning_effort=medium", "-s", "read-only", "-C", "/tmp/repo", "--skip-git-repo-check", "--", "Review."];

test("agent profiles are closed and request a role-specific sandbox", () => {
  assert.deepEqual(requested, { adapter: "builtin:codex-cli", binary: profile.binary, model: profile.model, effort: profile.effort, sandbox: "read-only" });
  assert.throws(() => validateAgentProfile({ ...profile, unknown: true }), /invalid profile/u);
  assert.throws(() => validateAgentProfile({ ...profile, binary: "codex" }), /invalid profile/u);
});

test("probe contract rejects non-ephemeral or identity-mismatched launch proof", () => {
  const value = { schema: "burnlist-codex-probe@1", requested, providerReported: { model: profile.model, sessionId: "provider-session", version: "1.2.3" }, technicallyProven: { argv, pidObserved: true }, guarantees: { freshSession: "enforced", filesystemWriteDeny: "enforced", foregroundHandle: "enforced", cancellation: "enforced", lifecycle: "enforced", usage: "unavailable" } };
  assert.deepEqual(validateCodexProbe(value).technicallyProven.argv, argv);
  assert.equal(validateCodexProbe({ ...value, providerReported: { model: null, sessionId: "provider-session", version: null } }).providerReported.model, null);
  assert.throws(() => validateCodexProbe({ ...value, technicallyProven: { ...value.technicallyProven, argv: argv.filter((item) => item !== "--ephemeral") } }), /technically-proven/u);
  assert.throws(() => validateCodexProbe({ ...value, requested: { ...requested, model: "gpt-5.6-terra" } }), /technically-proven/u);
});

test("configured Stage 1 routes have exact names, distinct profiles, and honest M1 guarantees", () => {
  const maker = { ...profile, id: "maker", authority: "write" };
  const resolved = resolveConfiguredStageOneRoutes({ profiles: [maker, profile], routes: { "implementation.standard": "maker", "review.strong": "reviewer" } });
  assert.equal(resolved.implementation.profile.id, "maker");
  assert.equal(resolved.implementation.authority, "write");
  assert.equal(resolved.review.profile.id, "reviewer");
  assert.deepEqual(resolved.review.guarantees, { freshSession: "enforced", filesystemWriteDeny: "supervised" });
  assert.throws(() => resolveConfiguredStageOneRoutes({ profiles: [maker, profile], routes: { "implementation.standard": "maker", "review.strong": "maker" } }), /distinct profile ids/u);
  assert.throws(() => resolveConfiguredStageOneRoutes({ profiles: [maker, profile], routes: { "implementation.standard": "reviewer", "review.strong": "maker" } }), /requires write authority/u);
});
