import { startCodexInvocation } from "./codex-cli.mjs";
import { runTrustedCapability } from "../capabilities/runner.mjs";
import { parseBoundedObject } from "../contracts/contract.mjs";
import { validateHostExecutionEnvelope } from "../contracts/host-execution.mjs";

const MAX_SUMMARY_BYTES = 1024;
const AGENT_RESULT_TYPES = new Set(["complete", "approve", "reject", "escalate"]);
const FINAL_REPORT_KEYS = ["schema", "runId", "nodeId", "attempt", "claimId", "invocationId", "assignmentId",
  "recipeRevision", "policyRevision", "inputCandidate", "outcome", "summary", "findings", "resolvedFindingIds"];
const MAX_FINAL_BYTES = 65_536;
const CANDIDATE = /^cm1-sha256:[a-f0-9]{64}$/u;
const ASSIGNMENT = /^as1-sha256:[a-f0-9]{64}$/u;
const CLAIM = /^cl1-sha256:[a-f0-9]{64}$/u;
const RECIPE = /^er1-sha256:[a-f0-9]{64}$/u;
const POLICY = /^bp1-sha256:[a-f0-9]{64}$/u;
const fail = (message) => { throw Object.assign(new Error(`Loop invocation: ${message}`), { code: "ELOOP_INVOKE" }); };
const exact = (value, keys) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function clean(value) {
  if (typeof value !== "string") return "process failed";
  const bytes = Buffer.from(value.replace(/[\0\r\n]/gu, " "), "utf8");
  let output = bytes.subarray(0, MAX_SUMMARY_BYTES).toString("utf8");
  // Buffer slicing can land in a multibyte code point; trim decoded code
  // points until the returned UTF-8 representation is genuinely bounded.
  while (Buffer.byteLength(output, "utf8") > MAX_SUMMARY_BYTES) output = Array.from(output).slice(0, -1).join("");
  return output;
}
function route(routes, name) {
  const value = routes?.[name];
  if (!value?.profile || typeof value.profile !== "object") fail(`missing ${name} route`);
  return value.profile;
}
function binding(value) {
  const keys = ["claimId", "assignmentId", "recipeRevision", "policyRevision", "inputCandidate",
    "instructionBytes", "itemText", "candidateContext", "reviewerEvidence"];
  if (!exact(value, keys) || !CLAIM.test(value.claimId) || !ASSIGNMENT.test(value.assignmentId)
    || !RECIPE.test(value.recipeRevision) || !POLICY.test(value.policyRevision) || !CANDIDATE.test(value.inputCandidate)
    || typeof value.instructionBytes !== "string" || !value.instructionBytes || Buffer.byteLength(value.instructionBytes) > 65_536
    || typeof value.itemText !== "string" || !value.itemText || Buffer.byteLength(value.itemText) > 65_536
    || typeof value.candidateContext !== "string" || Buffer.byteLength(value.candidateContext) > 65_536
    || !Array.isArray(value.reviewerEvidence) || value.reviewerEvidence.length > 50
    || value.reviewerEvidence.some((item) => typeof item !== "string" || Buffer.byteLength(item) > 4096))
    fail("invalid invocation binding");
  return value;
}
function boundaryCandidate(candidateForBoundary, expected) {
  if (typeof candidateForBoundary !== "function") return expected;
  const value = candidateForBoundary();
  const id = typeof value === "string" ? value : value?.id;
  if (!CANDIDATE.test(id) || id !== expected) fail("candidate changed at evidence boundary");
  return id;
}
function finalPrompt(invocation, node, current) {
  return ["Burnlist Stage 1 invocation.", `run=${invocation.runId}`, `node=${node.id}`, `attempt=${invocation.attempt}`,
    `claim=${current.claimId}`, `invocation=${invocation.invocationId}`, `assignment=${current.assignmentId}`,
    `recipe=${current.recipeRevision}`, `policy=${current.policyRevision}`, `candidate=${current.inputCandidate}`,
    `role=${node.role ?? "check"}`,
    "Burnlist owns graph routing and checks; host output is transport-only and idempotent by replaying the exact final report.",
    "Report exactly one canonical object with this schema: burnlist.agent-final@1",
    "Required report fields: schema, runId, nodeId, attempt, claimId, invocationId, assignmentId, recipeRevision, policyRevision, inputCandidate, outcome, summary, findings, resolvedFindingIds.",
    "Do not include destination or any graph transitions; no host-selected edges are accepted.",
    "Host result contracts are by node mode: task=>complete, review=>approve|reject|escalate.",
    "Host claim envelopes are bounded; use exact prepared claim identity and expiry semantics from the transport contract.",
    "Host telemetry is optional but, if provided, must use burnlist-loop-host-telemetry@1 with provenance=host-reported and non-negative token/time fields.",
    "FROZEN INSTRUCTIONS:", current.instructionBytes, "ASSIGNED ITEM:", current.itemText,
    "CANDIDATE CONTEXT:", current.candidateContext, "REVIEW EVIDENCE:", JSON.stringify(current.reviewerEvidence),
    "OPEN FINDINGS:", JSON.stringify(current.openFindings ?? [])].join("\n");
}
function finalTexts(events) {
  const texts = [];
  const finals = [];
  for (const event of events) {
    if (event?.type !== "item.completed" || !event.item || typeof event.item !== "object" || Array.isArray(event.item)
      || event.item.type !== "agent_message" || typeof event.item.text !== "string") continue;
    const text = event.item.text;
    try {
      const value = parseBoundedObject(Buffer.from(text, "utf8"), { maximumBytes: MAX_FINAL_BYTES, maximumDepth: 2, label: "agent final" });
      if (value.schema === "burnlist.agent-final@1") finals.push(text);
    } catch {
      // preceding conversational messages are permitted.
    }
    texts.push(text);
  }
  if (!texts.length) fail("agent emitted no final message");
  return { texts, finals };
}
function agentResult(events, invocation, node, current) {
  const { texts, finals } = finalTexts(events);
  if (!finals.length) fail("malformed or missing terminal agent result");
  if (!finals.every((value) => value === finals[0])) fail("duplicate terminal reports differ");
  const envelopes = [];
  for (let index = 0; index < texts.length; index += 1) {
    try {
      const value = parseBoundedObject(Buffer.from(texts[index], "utf8"), { maximumBytes: MAX_FINAL_BYTES, maximumDepth: 2, label: "agent final" });
      if (value.schema === "burnlist.agent-final@1") envelopes.push({ index, value });
    } catch {
      // non-final conversational lines are tolerated.
    }
  }
  if (envelopes.at(-1).index !== texts.length - 1 || envelopes.length !== finals.length) fail("malformed or ambiguous terminal agent result");
  const result = envelopes[0].value;
  if (!exact(result, FINAL_REPORT_KEYS) || result.schema !== "burnlist.agent-final@1" || result.runId !== invocation.runId
    || result.nodeId !== node.id || result.attempt !== invocation.attempt || result.invocationId !== invocation.invocationId
    || result.claimId !== current.claimId || result.assignmentId !== current.assignmentId
    || result.recipeRevision !== current.recipeRevision || result.policyRevision !== current.policyRevision
    || result.inputCandidate !== current.inputCandidate
    || !AGENT_RESULT_TYPES.has(result.outcome) || typeof result.summary !== "string") fail("malformed or stale agent result");
  const allowed = node.mode === "task" ? result.outcome === "complete" : ["approve", "reject", "escalate"].includes(result.outcome);
  if (!allowed) fail("agent result is illegal for node");
  return { kind: result.outcome, summary: clean(result.summary), outputBytes: Buffer.byteLength(texts.at(-1), "utf8"),
    findings: result.findings, resolvedFindingIds: result.resolvedFindingIds };
}
function boundedCompletion(handle, milliseconds) {
  if (!milliseconds) return handle.completion.then((value) => ({ value, timedOut: false }));
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(async () => {
      try { handle.cancel(); } catch { /* a broken controller is still bounded */ }
      const forced = await Promise.race([
        Promise.resolve(handle.completion).then((value) => ({ value }), () => ({ value: null })),
        new Promise((done) => setTimeout(() => done(null), 500)),
      ]);
      resolve(forced ? { ...forced, timedOut: true } : { value: null, cleanupLost: true });
    }, milliseconds);
  });
  // Attaching both handlers avoids a later rejected completion becoming an
  // unhandled rejection after the bounded timeout result has been returned.
  const settled = Promise.resolve(handle.completion).then((value) => ({ value, timedOut: false }), () => ({ value: null, timedOut: false, failed: true }));
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

/**
 * M3 adapter seam for M2's normalized invoke callback.  `bindingFor` provides
 * the immutable assignment/candidate pair that the M2 invocation shape lacks;
 * a final cannot be accepted without both values matching exactly.
 */
export function createNormalizedInvocation({ repoRoot, routes, nodes, bindingFor, candidateForBoundary = null,
  startAgent = startCodexInvocation, runCheck = runTrustedCapability, agentTimeoutMs = 0 }) {
  if (typeof repoRoot !== "string" || !repoRoot.startsWith("/") || !(nodes instanceof Map) || typeof bindingFor !== "function"
    || !(candidateForBoundary === null || typeof candidateForBoundary === "function")
    || typeof startAgent !== "function" || typeof runCheck !== "function" || !Number.isSafeInteger(agentTimeoutMs)
    || agentTimeoutMs < 0 || agentTimeoutMs > 86_400_000) fail("invalid dispatcher input");
  let active = null;
  async function invokeBound(invocation, node, current, requireReviewEvidence = true) {
    if (node.mode === "review" && (!current.candidateContext || requireReviewEvidence && !current.reviewerEvidence.length))
      return Object.freeze({ kind: "error", summary: "review context is incomplete", outputBytes: 0 });
    if (node.kind === "check") {
      try {
        boundaryCandidate(candidateForBoundary, current.inputCandidate);
        const checked = await runCheck({ repoRoot, capabilityId: node.capability, inputCandidate: current.inputCandidate });
        boundaryCandidate(candidateForBoundary, current.inputCandidate);
        if (checked?.result?.inputCandidate !== current.inputCandidate || !["pass", "fail"].includes(checked?.result?.outcome)) fail("stale trusted check result");
        const summary = checked.result.timedOut ? "repository check timed out" : checked.result.truncated ? "repository check output limit" : `repository check ${checked.result.outcome}`;
        return Object.freeze({ kind: checked.result.timedOut ? "timeout" : checked.result.outcome, summary, outputBytes: Buffer.isBuffer(checked.evidence) ? checked.evidence.length : 0 });
      } catch (error) { return Object.freeze({ kind: "error", summary: clean(error?.message), outputBytes: 0 }); }
    }
    const profile = route(routes, node.mode === "review" ? "review" : "implementation");
    try {
      if (node.mode === "review") boundaryCandidate(candidateForBoundary, current.inputCandidate);
      const handle = startAgent({ profile, cwd: repoRoot, prompt: finalPrompt(invocation, node, current) });
      if (!handle || typeof handle.cancel !== "function" || !handle.completion || typeof handle.completion.then !== "function") fail("agent did not return a foreground handle");
      active = handle;
      const completed = await boundedCompletion(handle, agentTimeoutMs);
      if (completed.cleanupLost) return Object.freeze({ kind: "lost", summary: "agent deadline cleanup unproven", outputBytes: 0 });
      if (completed.value?.outcome === "quarantined") return Object.freeze({ kind: "lost", summary: "agent process cleanup unproven", outputBytes: 0 });
      if (completed.timedOut) return Object.freeze({ kind: "timeout", summary: "agent deadline exceeded", outputBytes: 0 });
      if (completed.failed) return Object.freeze({ kind: "error", summary: "agent process failed", outputBytes: 0 });
      if (completed.value.outcome === "cancelled") return Object.freeze({ kind: "cancelled", summary: "agent cancelled", outputBytes: 0 });
      if (completed.value.outcome !== "completed") return Object.freeze({ kind: "error", summary: "agent process failed", outputBytes: 0 });
      if (node.mode === "review") boundaryCandidate(candidateForBoundary, current.inputCandidate);
      return Object.freeze(agentResult(completed.value.events, invocation, node, current));
    } catch (error) { return Object.freeze({ kind: "error", summary: clean(error?.message), outputBytes: 0 }); }
    finally { active = null; }
  }
  async function invoke(invocation) {
    const node = nodes.get(invocation?.nodeId);
    if (!invocation || typeof invocation !== "object" || !node || typeof node !== "object") fail("invalid invocation");
    let current;
    try { current = binding(bindingFor(invocation, node)); } catch (error) { return Object.freeze({ kind: "error", summary: clean(error?.message), outputBytes: 0 }); }
    const result = await invokeBound(invocation, node, current);
    const { findings: _findings, resolvedFindingIds: _resolved, ...normalized } = result;
    return Object.freeze(normalized);
  }
  /** Executes the exact controller-prepared agent input; no second prompt binding is invented. */
  async function invokePrepared(envelopeBytes) {
    const envelope = validateHostExecutionEnvelope(envelopeBytes), input = envelope.input.value;
    const node = nodes.get(input.nodeId);
    if (!node || node.kind !== "agent") fail("prepared invocation does not target an agent node");
    const current = {
      claimId: input.claimId, assignmentId: input.assignmentId, recipeRevision: input.recipeRevision,
      policyRevision: input.policyRevision, inputCandidate: input.inputCandidate,
      instructionBytes: Buffer.from(input.instructionBytes, "base64").toString("utf8"),
      itemText: input.itemText ? Buffer.from(input.itemText, "base64").toString("utf8") : "legacy prepared claim",
      candidateContext: Buffer.from(input.candidateContext, "base64").toString("utf8"), reviewerEvidence: input.reviewerEvidence,
      openFindings: input.openFindings ?? [],
    };
    return invokeBound(input, node, current);
  }
  Object.defineProperty(invoke, "cancel", { value: () => active?.cancel?.() === true, enumerable: false });
  Object.defineProperty(invoke, "active", { get: () => active !== null, enumerable: false });
  Object.defineProperty(invoke, "invokePrepared", { value: invokePrepared, enumerable: false });
  return invoke;
}
