import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import test from "node:test";
import { createDispatchAuthority, createInvocationInput, validateDispatchAuthority, validateInvocationInput, validateAgentResult } from "./agent-result.mjs";
import { createClaimFinalAuthority, validateCheckResult } from "./check-result.mjs";
import { findingId, validateFinding } from "./finding.mjs";
import { postWriteCandidateRecord } from "./contract.mjs";
import { rawSha256 } from "../dsl/hash.mjs";
import { parseRunRef } from "../assignment/selectors.mjs";
import { validateRunId } from "../run/run-codec.mjs";

const hex = (letter) => letter.repeat(64);
const d = (prefix, letter) => `${prefix}:${hex(letter)}`;
const binding = Object.freeze({
  runId: "run:01arz3ndektsv4rrffq69g5fav", nodeId: "review", attempt: 2,
  claimId: d("cl1-sha256", "1"), assignmentId: d("as1-sha256", "2"), invocationId: d("iv1-sha256", "3"),
  recipeRevision: d("er1-sha256", "4"), policyRevision: d("bp1-sha256", "5"), inputCandidate: d("cm1-sha256", "6"),
});
const artifact = d("artifact:sha256", "a");
const raw = d("sha256", "b");
function finding(severity = "minor", summary = "Evidence is insufficient") {
  const evidenceRefs = [artifact]; return { id: findingId({ severity, summary, evidenceRefs }), severity, summary, evidenceRefs };
}
function agent(outcome, extra = {}) { return { schema: "agent-result@1", ...binding, outcome, findings: [], resolvedFindingIds: [], ...extra }; }
function check(outcome, extra = {}) { return { schema: "check-result@1", ...binding, capabilityRevision: d("cp1-sha256", "7"), outcome, exitCode: outcome === "pass" ? 0 : 1, evidenceDigest: raw, truncated: false, ...extra }; }
function bytes(value) { return Buffer.from(JSON.stringify(value)); }
function invocation(extra = {}) {
  const instruction = Buffer.from("Follow the frozen instructions.\n");
  return { schema: "burnlist-loop-invocation-input@1", ...binding, itemRevision: d("id1-sha256", "8"), instructionDigest: rawSha256(instruction),
    instructionBytes: instruction.toString("base64"), candidateContext: Buffer.from("candidate-context@1\n").toString("base64"), reviewerEvidence: [], ...extra };
}
function dispatch(input, extra = {}) {
  return createDispatchAuthority({ schema: "burnlist-loop-dispatch-authority@1", state: "prepared-before-dispatch", ...binding,
    itemRevision: input.value.itemRevision, inputSchema: input.value.schema, inputDigest: input.digest, inputByteLength: input.bytes.length, ...extra });
}
function fakeAdapterDecode(inputBytes, authorityBytes) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const authority = JSON.parse(decoder.decode(authorityBytes)); const input = JSON.parse(decoder.decode(inputBytes));
  const digest = `sha256:${createHash("sha256").update(inputBytes).digest("hex")}`;
  assert.equal(authority.schema, "burnlist-loop-dispatch-authority@1"); assert.equal(authority.state, "prepared-before-dispatch");
  assert.equal(authority.inputByteLength, inputBytes.length); assert.equal(authority.inputDigest, digest);
  for (const key of ["runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate", "itemRevision"]) assert.equal(input[key], authority[key]);
  return { authority, input, digest };
}

test("one canonical 128-bit RunRef grammar governs selectors, results, dispatch, and storage", () => {
  const valid = [`run:0${"0".repeat(25)}`, `run:7${"z".repeat(25)}`];
  const invalid = [`run:8${"0".repeat(25)}`, `run:z${"0".repeat(25)}`, `run:0${"0".repeat(24)}`, `run:0${"0".repeat(26)}`];
  for (const runId of valid) {
    assert.equal(parseRunRef(runId).selector, runId); assert.equal(validateRunId(runId), runId);
    assert.equal(validateAgentResult(agent("complete", { runId }), { mode: "task" }).runId, runId);
    assert.equal(validateCheckResult(check("pass", { runId })).runId, runId);
    const input = createInvocationInput(invocation({ runId })); assert.equal(input.value.runId, runId);
    assert.equal(validateDispatchAuthority(dispatch(input, { runId }).bytes).value.runId, runId);
  }
  for (const runId of invalid) {
    assert.throws(() => parseRunRef(runId), /RunRef/u); assert.throws(() => validateRunId(runId), /RunRef/u);
    assert.throws(() => validateAgentResult(agent("complete", { runId }), { mode: "task" }), /identity/u);
    assert.throws(() => validateCheckResult(check("pass", { runId })), /identity/u);
    assert.throws(() => createInvocationInput(invocation({ runId })), /identity/u);
    assert.throws(() => dispatch(createInvocationInput(invocation()), { runId }), /dispatch authority/u);
  }
});

test("agent outcomes and every finding severity are closed and approval cannot leave blockers", () => {
  assert.deepEqual(validateAgentResult(agent("complete"), { mode: "task" }).outcome, "complete");
  for (const outcome of ["approve", "reject", "escalate"]) assert.equal(validateAgentResult(agent(outcome), { mode: "review" }).outcome, outcome);
  for (const severity of ["blocker", "major", "minor", "note"]) assert.equal(validateFinding(finding(severity)).severity, severity);
  const open = new Map([[finding("blocker").id, finding("blocker")]]);
  assert.throws(() => validateAgentResult(agent("approve"), { mode: "review", openFindings: open }), /neither preserved|unresolved/u);
  assert.throws(() => validateAgentResult(agent("reject"), { mode: "review", openFindings: open }), /neither preserved/u);
  assert.equal(validateAgentResult(agent("reject", { findings: [finding("blocker")] }), { mode: "review", openFindings: open }).outcome, "reject");
  assert.equal(validateAgentResult(agent("approve", { resolvedFindingIds: [finding("blocker").id] }), { mode: "review", openFindings: open }).outcome, "approve");
  assert.throws(() => validateAgentResult(agent("complete", { findings: [finding()] }), { mode: "task" }), /cannot carry/u);
  assert.throws(() => validateAgentResult(agent("reject", { findings: [{ ...finding(), summary: "changed" }] }), { mode: "review" }), /id does not bind/u);
});

test("finding ids bind distinct accepted UTF-8 and reject surrogate, control, and format code points before hashing", () => {
  assert.notEqual(finding("note", "é").id, finding("note", "e\u0301").id);
  assert.equal(validateFinding(finding("note", "レビュー")).summary, "レビュー");
  for (const summary of ["bad\u0000text", "bad\u200etext", "bad\ud800text", "bad\u202etext"])
    assert.throws(() => findingId({ severity: "note", summary, evidenceRefs: [artifact] }), /invalid finding/u);
});

test("check outcome table accepts only executable pass/fail combinations", () => {
  assert.equal(validateCheckResult(check("pass")).outcome, "pass");
  assert.equal(validateCheckResult(check("fail")).outcome, "fail");
  assert.equal(validateCheckResult(check("fail", { exitCode: 0, truncated: true })).outcome, "fail");
  for (const invalid of [check("pass", { exitCode: 1 }), check("pass", { truncated: true }), check("fail", { exitCode: 0, truncated: false })]) assert.throws(() => validateCheckResult(invalid), /invalid/u);
});

test("closed bounded contracts reject unknown, missing, oversized, duplicate, and conflicting fields", () => {
  assert.throws(() => validateAgentResult({ ...agent("complete"), extra: true }, { mode: "task" }), /invalid/u);
  const missing = agent("complete"); delete missing.claimId; assert.throws(() => validateAgentResult(missing, { mode: "task" }), /invalid/u);
  assert.throws(() => validateAgentResult(agent("reject", { findings: Array.from({ length: 51 }, () => finding()) }), { mode: "review" }), /invalid/u);
  assert.throws(() => validateAgentResult(agent("reject", { findings: [finding("minor", "\u0000")] }), { mode: "review" }), /invalid/u);
  assert.throws(() => validateAgentResult(agent("reject", { findings: [finding(), finding()] }), { mode: "review" }), /not id-sorted/u);
  assert.throws(() => validateCheckResult({ ...check("pass"), capabilityRevision: "wrong" }), /invalid/u);
});

test("claim final state machine buffers, exits, and transitions only at one quiescence seal", () => {
  const authority = createClaimFinalAuthority({ expected: binding, type: "agent", mode: "review" }); const accepted = bytes(agent("approve"));
  assert.equal(authority.accept(accepted).disposition, "buffered"); assert.equal(authority.state, "candidate"); assert.equal(authority.final, null);
  assert.equal(authority.accept(accepted).disposition, "idempotent-audit");
  assert.equal(authority.accept(bytes(agent("reject"))).reason, "conflicting-duplicate-final");
  assert.equal(authority.accept(Buffer.from("not json"), { sourceClaimId: d("cl1-sha256", "9") }).reason, "replaced-or-late-claim");
  assert.throws(() => authority.seal({ quiescent: true }), /before process exit/u);
  assert.equal(authority.exit().disposition, "exit-recorded"); assert.equal(authority.state, "exited-candidate");
  assert.equal(authority.accept(accepted).reason, "process-exited");
  assert.throws(() => authority.seal({ quiescent: false }), /quiescence/u);
  assert.equal(authority.seal({ quiescent: true }).disposition, "transition"); assert.equal(authority.state, "sealed-success");
  assert.equal(authority.final.outcome, "approve");
  assert.equal(authority.seal({ quiescent: true }).disposition, "idempotent-audit");
  for (const late of [accepted, bytes(agent("reject")), Buffer.from("not json")]) assert.equal(authority.accept(late).reason, "claim-sealed");
});

test("claim final failure table is deterministic for empty, malformed, stale, mismatch, and valid-then-malformed", () => {
  for (const malformed of [Buffer.from("not json"), Buffer.from('{"schema":"check-result@1","schema":"check-result@1"}'), Buffer.alloc(65_537, 32)]) {
    const current = createClaimFinalAuthority({ expected: { ...binding, capabilityRevision: d("cp1-sha256", "7") }, type: "check" });
    assert.equal(current.accept(malformed).disposition, "failure-pending-quiescence");
    assert.equal(current.accept(bytes(check("pass"))).reason, "claim-faulted");
    current.exit(); assert.equal(current.seal({ quiescent: true }).reason, "malformed-current-result");
  }
  const empty = createClaimFinalAuthority({ expected: binding, type: "agent", mode: "review" });
  empty.exit(); assert.equal(empty.seal({ quiescent: true }).reason, "exit-without-valid-final");

  const mismatch = createClaimFinalAuthority({ expected: { ...binding, capabilityRevision: d("cp1-sha256", "7") }, type: "check" });
  assert.equal(mismatch.accept(bytes(check("pass", { inputCandidate: d("cm1-sha256", "9") }))).reason, "binding-mismatch");
  assert.equal(mismatch.accept(bytes(check("pass", { capabilityRevision: d("cp1-sha256", "9") }))).reason, "capability-mismatch");
  mismatch.exit(); assert.equal(mismatch.seal({ quiescent: true }).reason, "exit-without-valid-final");

  const ambiguous = createClaimFinalAuthority({ expected: binding, type: "agent", mode: "review" });
  assert.equal(ambiguous.accept(bytes(agent("approve"))).disposition, "buffered");
  assert.equal(ambiguous.accept(Buffer.from("not json")).disposition, "failure-pending-quiescence");
  ambiguous.exit(); assert.equal(ambiguous.seal({ quiescent: true }).reason, "malformed-current-result"); assert.equal(ambiguous.final, null);

  const stale = createClaimFinalAuthority({ expected: binding, type: "agent", mode: "review" });
  assert.equal(stale.accept(Buffer.from("not json"), { sourceClaimId: d("cl1-sha256", "9") }).reason, "replaced-or-late-claim");
  assert.equal(stale.accept(bytes(agent("approve"))).disposition, "buffered");
  stale.exit(); assert.equal(stale.seal({ quiescent: true }).disposition, "transition");
});

test("dispatch artifact and independent fake adapter assert exact invocation bytes and digest", () => {
  const built = createInvocationInput(invocation());
  assert.equal(built.bytes.toString("utf8"), `${JSON.stringify(invocation())}\n`);
  const authority = dispatch(built); assert.equal(validateDispatchAuthority(authority.bytes).digest, authority.digest);
  assert.equal(validateInvocationInput(built.bytes, authority.bytes).digest, built.digest);
  assert.equal(fakeAdapterDecode(built.bytes, authority.bytes).digest, built.digest);
  assert.throws(() => validateInvocationInput(built.bytes, dispatch(built, { inputDigest: raw }).bytes), /authority/u);
  const wrongItem = createInvocationInput(invocation({ itemRevision: d("id1-sha256", "9") }));
  assert.throws(() => validateInvocationInput(wrongItem.bytes, authority.bytes), /authority/u);
  const stale = createInvocationInput(invocation({ claimId: d("cl1-sha256", "9") }));
  assert.throws(() => validateInvocationInput(stale.bytes, authority.bytes), /authority/u);
  assert.throws(() => createInvocationInput(invocation({ candidateContext: Buffer.alloc(65537).toString("base64") })), /invalid/u);
  assert.throws(() => validateInvocationInput(Buffer.alloc(262_145, 0xff), authority.bytes), /bytes exceed/u);
  const duplicate = Buffer.from(built.bytes.toString().replace('{"schema":', '{"schema":"burnlist-loop-invocation-input@1","schema":'));
  assert.throws(() => validateInvocationInput(duplicate, authority.bytes), /duplicate/u);
  const deep = Buffer.from(built.bytes.toString().replace('"reviewerEvidence":[]', '"reviewerEvidence":[[[[]]]]'));
  assert.throws(() => validateInvocationInput(deep, authority.bytes), /depth/u);
  assert.throws(() => validateDispatchAuthority(Buffer.from('{"schema":"burnlist-loop-dispatch-authority@1","schema":"burnlist-loop-dispatch-authority@1"}')), /duplicate/u);
  assert.throws(() => validateInvocationInput(built.bytes, { arbitrary: true }), /first argument|buffer|Buffer/u);
});

test("dispatch authority is closed, bounded, canonical, and prepared before dispatch", () => {
  const built = createInvocationInput(invocation()); const valid = dispatch(built);
  for (const patch of [{ state: "dispatched" }, { inputByteLength: 0 }, { inputByteLength: 262_145 }, { extra: true }])
    assert.throws(() => createDispatchAuthority({ ...valid.value, ...patch }), /invalid dispatch authority/u);
  assert.throws(() => validateDispatchAuthority(Buffer.concat([valid.bytes, Buffer.from(" ")])), /canonical/u);
  assert.throws(() => validateDispatchAuthority(Buffer.alloc(16_385, 32)), /bytes exceed/u);
});

test("reviewer evidence is bounded, unique, and strictly UTF-8 sorted", () => {
  const second = d("artifact:sha256", "b");
  assert.equal(createInvocationInput(invocation({ reviewerEvidence: [artifact, second] })).value.reviewerEvidence.length, 2);
  for (const reviewerEvidence of [[artifact, artifact], [second, artifact], Array.from({ length: 51 }, () => artifact)])
    assert.throws(() => createInvocationInput(invocation({ reviewerEvidence })), /invalid invocation evidence/u);
});

test("only runner-owned quiescent authority can record a post-write candidate", () => {
  assert.equal(postWriteCandidateRecord({ actor: "runner", quiescent: true, candidate: binding.inputCandidate }).candidate, binding.inputCandidate);
  assert.throws(() => postWriteCandidateRecord({ actor: "adapter", quiescent: true, candidate: binding.inputCandidate }), /authority/u);
  assert.throws(() => postWriteCandidateRecord({ actor: "runner", quiescent: false, candidate: binding.inputCandidate }), /authority/u);
});
