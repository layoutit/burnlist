import assert from "node:assert/strict";
import test from "node:test";
import { createNormalizedInvocation } from "./normalized-invocation.mjs";

const profile = { id: "fake" };
const routes = { implementation: { profile }, review: { profile: { id: "review" } } };
const call = Object.freeze({ runId: "run:01arz3ndektsv4rrffq69g5fav", nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) });
const maker = Object.freeze({ id: "implement", kind: "agent", mode: "task", role: "maker", instructions: "make" });
const reviewer = Object.freeze({ id: "review", kind: "agent", mode: "review", role: "reviewer", instructions: "review" });
const check = Object.freeze({ id: "verify", kind: "check", capability: "repo-verify" });
const current = Object.freeze({
  claimId: `cl1-sha256:${"1".repeat(64)}`, assignmentId: `as1-sha256:${"b".repeat(64)}`,
  recipeRevision: `er1-sha256:${"2".repeat(64)}`, policyRevision: `bp1-sha256:${"3".repeat(64)}`,
  inputCandidate: `cm1-sha256:${"a".repeat(64)}`, instructionBytes: "Do the frozen work.\n",
  itemText: "- [ ] M3 | Connect processes\n", candidateContext: "candidate-v1\n", reviewerEvidence: ["verify:pass"],
});
function final(invocation, node, outcome = "complete", extra = {}) {
  return JSON.stringify({ schema: "burnlist.agent-final@1", runId: invocation.runId, nodeId: node.id, attempt: invocation.attempt,
    claimId: current.claimId, invocationId: invocation.invocationId, assignmentId: current.assignmentId,
    recipeRevision: current.recipeRevision, policyRevision: current.policyRevision,
    inputCandidate: current.inputCandidate, outcome, summary: "ok", ...extra });
}
function event(...texts) { return texts.map((text) => ({ type: "item.completed", item: { type: "agent_message", text } })); }
function agent(events, outcome = "completed") { return () => ({ cancel() { return true; }, completion: Promise.resolve({ outcome, events }) }); }
function dispatcher({ startAgent, runCheck, timeout = 0, bindingFor = () => current, candidateForBoundary = null } = {}) {
  return createNormalizedInvocation({ repoRoot: "/repo", routes, nodes: new Map([[maker.id, maker], [reviewer.id, reviewer], [check.id, check]]), bindingFor,
    candidateForBoundary, startAgent: startAgent ?? agent(event(final(call, maker))), runCheck: runCheck ?? (async () => ({ result: { outcome: "pass", inputCandidate: current.inputCandidate, timedOut: false, truncated: false }, evidence: Buffer.from("check") })), agentTimeoutMs: timeout });
}

test("maps actual Codex agent-message finals for maker and fresh reviewer", async () => {
  const seen = [];
  const invoke = dispatcher({ startAgent: ({ profile: selected, prompt }) => {
    seen.push(selected.id); const node = selected.id === "review" ? reviewer : maker; const invocationId = /invocation=([a-f0-9]{32})/u.exec(prompt)[1];
    assert.match(prompt, /FROZEN INSTRUCTIONS:\nDo the frozen work\.\n/u);
    assert.match(prompt, /ASSIGNED ITEM:\n- \[ \] M3 \| Connect processes\n/u);
    return { cancel() { return true; }, completion: Promise.resolve({ outcome: "completed",
      events: event("Working notes before the terminal envelope.", final({ ...call, nodeId: node.id, invocationId }, node, node === reviewer ? "reject" : "complete")) }) };
  } });
  assert.equal((await invoke(call)).kind, "complete");
  assert.equal((await invoke({ ...call, nodeId: "review", invocationId: "c".repeat(32) })).kind, "reject");
  assert.deepEqual(seen, ["fake", "review"]);
});

test("rejects malformed or stale claim, revision, candidate, assignment, and invocation finals", async () => {
  for (const extra of [{ invocationId: "b".repeat(32) }, { claimId: `cl1-sha256:${"9".repeat(64)}` },
    { recipeRevision: `er1-sha256:${"8".repeat(64)}` }, { policyRevision: `bp1-sha256:${"7".repeat(64)}` },
    { inputCandidate: `cm1-sha256:${"c".repeat(64)}` }, { assignmentId: `as1-sha256:${"d".repeat(64)}` }]) {
    const invoke = dispatcher({ startAgent: agent(event(final(call, maker, "complete", extra))) });
    assert.equal((await invoke(call)).kind, "error");
  }
  assert.equal((await dispatcher({ startAgent: agent(event("not json")) })(call)).kind, "error");
  assert.equal((await dispatcher({ startAgent: agent(event(final(call, maker), final(call, maker))) })(call)).kind, "error");
  assert.equal((await dispatcher({ bindingFor: () => ({ inputCandidate: current.inputCandidate }) })(call)).kind, "error");
});

test("maps trusted checks including timeout and stale candidate without invoking an agent", async () => {
  const verify = { ...call, nodeId: "verify" };
  assert.equal((await dispatcher()(verify)).kind, "pass");
  const timeout = await dispatcher({ runCheck: async () => ({ result: { outcome: "fail", inputCandidate: current.inputCandidate, timedOut: true, truncated: false }, evidence: Buffer.from("x") }) })(verify);
  assert.equal(timeout.kind, "timeout");
  const stale = await dispatcher({ runCheck: async () => ({ result: { outcome: "pass", inputCandidate: `cm1-sha256:${"f".repeat(64)}`, timedOut: false, truncated: false }, evidence: Buffer.alloc(0) }) })(verify);
  assert.equal(stale.kind, "error");
});

test("invalidates check and review evidence when the worktree drifts at a boundary", async () => {
  const verify = { ...call, nodeId: "verify" };
  const changed = `cm1-sha256:${"f".repeat(64)}`;
  let captures = 0;
  const checkResult = await dispatcher({
    candidateForBoundary: () => ({ id: captures++ === 0 ? current.inputCandidate : changed }),
  })(verify);
  assert.equal(checkResult.kind, "error");
  captures = 0;
  const reviewResult = await dispatcher({
    candidateForBoundary: () => ({ id: captures++ === 0 ? current.inputCandidate : changed }),
    startAgent: agent(event(final({ ...call, nodeId: "review", invocationId: "c".repeat(32) }, reviewer, "approve"))),
  })({ ...call, nodeId: "review", invocationId: "c".repeat(32) });
  assert.equal(reviewResult.kind, "error");
});

test("agent deadline becomes lost if cancellation never settles", async () => {
  const invoke = dispatcher({ timeout: 10, startAgent: () => ({ cancel() { return true; }, completion: new Promise(() => {}) }) });
  assert.deepEqual(await invoke(call), { kind: "lost", summary: "agent deadline cleanup unproven", outputBytes: 0 });
});

test("summaries are valid UTF-8 and limited to 1024 bytes", async () => {
  const result = await dispatcher({ startAgent: agent(event(final(call, maker, "complete", { summary: "€".repeat(500) }))) })(call);
  assert.ok(Buffer.byteLength(result.summary, "utf8") <= 1024);
  assert.doesNotThrow(() => Buffer.from(result.summary, "utf8").toString("utf8"));
});
