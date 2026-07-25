import assert from "node:assert/strict";
import test from "node:test";
import { createDispatchAuthority, createInvocationInput } from "./agent-result.mjs";
import {
  createHostExecutionEnvelope, createHostExecutionReport, validateHostExecutionEnvelope,
  hostExecutionExpired, validateHostExecutionReport,
} from "./host-execution.mjs";
import { rawSha256 } from "../dsl/hash.mjs";

const hex = (letter) => letter.repeat(64);
const digest = (prefix, letter) => `${prefix}:${hex(letter)}`;
const binding = Object.freeze({ runId: "run:01arz3ndektsv4rrffq69g5fav", nodeId: "implement", attempt: 1,
  claimId: digest("cl1-sha256", "1"), assignmentId: digest("as1-sha256", "2"), invocationId: digest("iv1-sha256", "3"),
  recipeRevision: digest("er1-sha256", "4"), policyRevision: digest("bp1-sha256", "5"), inputCandidate: digest("cm1-sha256", "6") });

function fixture(patch = {}) {
  const instruction = Buffer.from("Implement the frozen task.\n");
  const input = createInvocationInput({ schema: "burnlist-loop-invocation-input@1", ...binding, itemRevision: digest("id1-sha256", "7"), execution: "host", intelligence: "fast",
    mode: "task", role: "maker", authority: "write", legalOutcomes: ["complete"], requires: [],
    instructionDigest: rawSha256(instruction), instructionBytes: instruction.toString("base64"),
    itemText: Buffer.from("- [ ] H1 | Implement host execution\n").toString("base64"),
    candidateContext: Buffer.from("candidate-context@1\n").toString("base64"), reviewerEvidence: [] });
  const authority = createDispatchAuthority({ schema: "burnlist-loop-dispatch-authority@1", state: "prepared-before-dispatch", ...binding,
    itemRevision: input.value.itemRevision, inputSchema: input.value.schema, inputDigest: input.digest, inputByteLength: input.bytes.length });
  return { schema: "burnlist-loop-host-execution@1", ...binding, issuedAt: 1_000, expiresAt: 1_801_000,
    invocationInput: input.bytes.toString("base64"), dispatchAuthority: authority.bytes.toString("base64"), ...patch };
}

test("host execution envelope canonically binds the exact prepared invocation", () => {
  const built = createHostExecutionEnvelope(fixture());
  assert.equal(built.bytes.toString(), `${JSON.stringify(fixture())}\n`);
  const parsed = validateHostExecutionEnvelope(built.bytes);
  assert.equal(parsed.digest, built.digest);
  assert.equal(parsed.input.value.claimId, binding.claimId);
  assert.equal(parsed.authority.value.inputDigest, parsed.input.digest);
  assert.equal(Buffer.from(parsed.input.value.itemText, "base64").toString(), "- [ ] H1 | Implement host execution\n");
  assert.deepEqual({ mode: parsed.input.value.mode, role: parsed.input.value.role, authority: parsed.input.value.authority,
    legalOutcomes: parsed.input.value.legalOutcomes }, { mode: "task", role: "maker", authority: "write", legalOutcomes: ["complete"] });
});

test("pre-H6 host envelopes retain their legacy invocation bytes", () => {
  const instruction = Buffer.from("Implement the frozen task.\n");
  const input = createInvocationInput({ schema: "burnlist-loop-invocation-input@1", ...binding, itemRevision: digest("id1-sha256", "7"),
    instructionDigest: rawSha256(instruction), instructionBytes: instruction.toString("base64"),
    candidateContext: Buffer.from("candidate-context@1\n").toString("base64"), reviewerEvidence: [] });
  assert.equal(Object.hasOwn(input.value, "execution"), false);
  const authority = createDispatchAuthority({ schema: "burnlist-loop-dispatch-authority@1", state: "prepared-before-dispatch", ...binding,
    itemRevision: input.value.itemRevision, inputSchema: input.value.schema, inputDigest: input.digest, inputByteLength: input.bytes.length });
  const envelope = createHostExecutionEnvelope({ schema: "burnlist-loop-host-execution@1", ...binding, issuedAt: 1_000, expiresAt: 1_801_000,
    invocationInput: input.bytes.toString("base64"), dispatchAuthority: authority.bytes.toString("base64") });
  assert.deepEqual(validateHostExecutionEnvelope(envelope.bytes).input.bytes, input.bytes);
});

test("host envelope rejects identity fabrication, noncanonical input bytes, and host transition fields", () => {
  assert.throws(() => createHostExecutionEnvelope(fixture({ claimId: digest("cl1-sha256", "9") })), /binding mismatch/u);
  assert.throws(() => createHostExecutionEnvelope({ ...fixture(), destination: "burn" }), /invalid host execution envelope/u);
  assert.throws(() => createHostExecutionEnvelope({ ...fixture(), outcome: "complete" }), /invalid host execution envelope/u);
  const value = fixture(); value.invocationInput = `${value.invocationInput} `;
  assert.throws(() => createHostExecutionEnvelope(value), /invalid invocation input/u);
});

test("host envelope is bounded, canonical, and has a finite ordered lease", () => {
  const built = createHostExecutionEnvelope(fixture());
  assert.throws(() => validateHostExecutionEnvelope(Buffer.concat([built.bytes, Buffer.from(" ")])), /canonical/u);
  assert.equal(hostExecutionExpired(built, 1_800_999), false);
  assert.equal(hostExecutionExpired(built, 1_801_000), true);
  assert.throws(() => createHostExecutionEnvelope(fixture({ expiresAt: 1_000 })), /expiry/u);
  assert.throws(() => createHostExecutionEnvelope(fixture({ expiresAt: 86_401_001 })), /expiry/u);
  assert.throws(() => createHostExecutionEnvelope(fixture({ issuedAt: "1000" })), /issuedAt/u);
  assert.throws(() => validateHostExecutionEnvelope(Buffer.alloc(400_001, 32)), /bounds/u);
});

function report(envelope, patch = {}) {
  return {
    schema: "burnlist-loop-host-report@1",
    result: {
      schema: "agent-result@1", ...binding, outcome: "complete", findings: [], resolvedFindingIds: [],
    },
    telemetry: {
      schema: "burnlist-loop-host-telemetry@1", provenance: "host-reported", executor: "claude-native",
      displayName: "H1 implement", provider: "anthropic", model: "fast", effort: "low",
      startedAt: 1000, completedAt: 2000, inputTokens: null, outputTokens: null,
    },
    ...patch,
  };
}

test("host report binds a legal result and explicitly host-reported telemetry", () => {
  const envelope = createHostExecutionEnvelope(fixture());
  const built = createHostExecutionReport(report(envelope), { envelope, mode: "task" });
  assert.equal(validateHostExecutionReport(built.bytes, { envelope, mode: "task" }).digest, built.digest);
  assert.equal(built.value.telemetry.provenance, "host-reported");
});

test("host report rejects transition choice, stale identity, illegal outcome, and false telemetry", () => {
  const envelope = createHostExecutionEnvelope(fixture());
  assert.throws(() => createHostExecutionReport({ ...report(envelope), destination: "burn" }, { envelope, mode: "task" }), /invalid host execution report/u);
  const stale = report(envelope); stale.result = { ...stale.result, claimId: digest("cl1-sha256", "9") };
  assert.throws(() => createHostExecutionReport(stale, { envelope, mode: "task" }), /binding mismatch/u);
  const illegal = report(envelope); illegal.result = { ...illegal.result, outcome: "approve" };
  assert.throws(() => createHostExecutionReport(illegal, { envelope, mode: "task" }), /not allowed/u);
  const telemetry = report(envelope); telemetry.telemetry = { ...telemetry.telemetry, provenance: "managed" };
  assert.throws(() => createHostExecutionReport(telemetry, { envelope, mode: "task" }), /host telemetry/u);
  const backwards = report(envelope); backwards.telemetry = { ...backwards.telemetry, completedAt: 999 };
  assert.throws(() => createHostExecutionReport(backwards, { envelope, mode: "task" }), /timing/u);
});

test("host report bytes make retransmission identity explicit", () => {
  const envelope = createHostExecutionEnvelope(fixture());
  const first = createHostExecutionReport(report(envelope), { envelope, mode: "task" });
  const duplicate = validateHostExecutionReport(first.bytes, { envelope, mode: "task" });
  assert.equal(duplicate.digest, first.digest);
  const changed = createHostExecutionReport(report(envelope, { telemetry: null }), { envelope, mode: "task" });
  assert.notEqual(changed.digest, first.digest);
  assert.throws(() => validateHostExecutionReport(Buffer.concat([first.bytes, Buffer.from(" ")]), { envelope, mode: "task" }), /canonical/u);
});
