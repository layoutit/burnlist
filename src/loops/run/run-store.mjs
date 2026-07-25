import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { withDirectoryLock } from "../../server/dir-lock.mjs";
import { isRunRef } from "./run-ref.mjs";
import { appendJournalRecord, createJournalRecord, MAX_JOURNAL_RECORDS, readJournal, writeInitialJournal } from "./run-journal.mjs";
import { foldRun } from "./run-fold.mjs";
import { atomicTerminalState, isTerminalState, validateGraph } from "./state-machine.mjs";
import { parseBoundedObject } from "../contracts/contract.mjs";
import { publishLoopProjectionInvalidation } from "../events/projection-events.mjs";
import { currentRunAuthority } from "./current-authority.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { loadBoundPolicy } from "./run-artifacts.mjs";
import { createHostClaimAbandonment, hostClaimExpired, validateHostClaim } from "./run-claim.mjs";
import { validateHostExecutionEnvelope, validateHostExecutionReport } from "../contracts/host-execution.mjs";

const fail = (message, code = "ERUN_STORE") => { throw Object.assign(new Error(`Run store: ${message}`), { code }); };
const runName = (id) => Buffer.from(id).toString("hex");
export function runStore(repoRoot, { clock = () => Date.now(), random = randomBytes, hooks = {}, publishProjection = publishLoopProjectionInvalidation, journalMaximum = MAX_JOURNAL_RECORDS } = {}) {
  const root = resolve(repoRoot), base = join(root, ".local", "burnlist", "loop", "m2"), runs = join(base, "runs"), now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail("invalid clock"); return value; };
  if (!Number.isInteger(journalMaximum) || journalMaximum < 2 || journalMaximum > MAX_JOURNAL_RECORDS) fail("invalid journal maximum", "EJOURNAL");
  const pathFor = (id) => join(runs, runName(id)), journalFor = (id) => join(pathFor(id), "journal"), lockFor = (id) => join(pathFor(id), ".lock"), proofPath = (id) => join(pathFor(id), ".recovery-proof"), authorityPath = (id) => join(pathFor(id), "dispatch-authority.json"), executionRoot = (id) => join(pathFor(id), "host-executions"), executionPath = (id, digest) => {
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) fail("external claim envelope digest is invalid", "ECLAIM");
    return join(executionRoot(id), `${digest.slice(7)}.json`);
  }, reportRoot = (id) => join(pathFor(id), "host-reports"), reportPath = (id, digest) => {
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) fail("external report digest is invalid", "EREPORT");
    return join(reportRoot(id), `${digest.slice(7)}.json`);
  }, currentLock = join(base, ".current-runs.lock"), initialize = () => mkdirSync(runs, { recursive: true, mode: 0o700 }), currentAuthority = () => currentRunAuthority({ root, base, random });
  const assertId = (id) => { if (!isRunRef(id)) fail("invalid RunRef"); return id; };
  const locked = (id, fn) => { assertId(id); initialize(); return withDirectoryLock({ lockPath: lockFor(id), reclaimLiveAfterAge: false, errorFactory: () => fail("run is locked", "ELOCKED"), fn }); };
  const replay = (id) => {
    assertId(id);
    if (!existsSync(journalFor(id))) fail("run is missing", "ENOENT");
    const journal = readJournal(journalFor(id)), folded = foldRun(journal);
    if (folded.projection.runId !== id) fail("run identity mismatch");
    let loopIdentity = Object.freeze({ loopId: folded.graph.id, loopRevision: null });
    let agentRoutes = Object.freeze([]);
    if (existsSync(authorityPath(id))) {
      try {
        const authority = readAuthority(id), frozen = loadFrozenRecipe(Buffer.from(authority.frozenRecipe, "base64"));
        if (authority.itemRef !== folded.projection.itemRef) fail("sealed authority item does not match Run journal", "EAUTHORITY");
        if (JSON.stringify(frozen.ir) !== JSON.stringify(folded.graph)) fail("sealed recipe does not match Run graph", "EAUTHORITY");
        const policy = loadBoundPolicy(Buffer.from(authority.policy, "base64")).policy;
        loopIdentity = Object.freeze({ loopId: frozen.ir.id, loopRevision: frozen.revisions.executable });
        agentRoutes = Object.freeze(policy.routes.map(({ route, profile }) => Object.freeze({
          route,
          profileId: profile.id,
          adapter: profile.adapter,
          model: profile.model,
          effort: profile.effort,
          authority: profile.authority,
        })));
      } catch (error) {
        if (error?.code === "EAUTHORITY") throw error;
        fail("sealed dispatch authority is corrupt", "EAUTHORITY");
      }
    } else if (journal[0].value.payload.authorityRequired) fail("sealed dispatch authority is unavailable", "EAUTHORITY");
    return Object.freeze({ runId: id, journal, loopIdentity, agentRoutes, ...folded });
  };
  const retainsTerminalReserve = (current, writes = 1) => current.projection.sequence + writes < journalMaximum;
  const terminalKind = { converged: "converged", "needs-human": "lost", failed: "error", stopped: "cancelled", "budget-exhausted": "exhausted" };
  function prospective(id, current, type, payload, at = now()) {
    if (!retainsTerminalReserve(current)) fail("journal terminal reserve is required", "EJOURNAL");
    const record = createJournalRecord({ sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, at, type, payload });
    foldRun([...current.journal, record]); // reject poison before publication
    appendJournalRecord({ journalDirectory: journalFor(id), record });
    return Object.freeze({ record, ...replay(id) });
  }
  function assertLease(current, lease) { const held = current.execution.lease; if (!lease || !held || lease.generation !== held.generation || lease.token !== held.token) fail("stale lease", "ESTALE_LEASE"); }
  function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
  function syncParent(id) { syncDirectory(pathFor(id)); }
  function writeRecoveryProof(id, value) { const checked = { schema: "burnlist-loop-m2-recovery-proof@1", runId: id, generation: value.generation, token: value.token, recoveryProof: value.recoveryProof }, bytes = Buffer.from(`${JSON.stringify(checked)}\n`), temporary = `${proofPath(id)}.${random(8).toString("hex")}.tmp`; if (bytes.length > 1024) fail("recovery proof exceeds bounds"); let fd; try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, proofPath(id)); syncParent(id); } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); } }
  function readRecoveryProof(id) { let fd; try { const path = proofPath(id), entry = lstatSync(path); if (!entry.isFile() || entry.isSymbolicLink()) fail("recovery proof is corrupt"); fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); const before = fstatSync(fd); if (!before.isFile() || (before.mode & 0o777) !== 0o600 || before.size < 2 || before.size > 1024) fail("recovery proof is corrupt"); const bytes = Buffer.alloc(before.size); if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) fail("recovery proof changed while reading"); const after = fstatSync(fd); if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) fail("recovery proof changed while reading"); const value = JSON.parse(bytes.toString("utf8")); if (!value || Object.keys(value).length !== 5 || value.schema !== "burnlist-loop-m2-recovery-proof@1" || value.runId !== id || !Number.isSafeInteger(value.generation) || !/^[a-f0-9]{64}$/u.test(value.token) || !/^[a-f0-9]{64}$/u.test(value.recoveryProof)) fail("recovery proof is corrupt"); return value; } catch (error) { if (error?.code === "ENOENT") fail("lost-owner proof is unavailable", "ELOST_PROOF"); throw error; } finally { if (fd !== undefined) closeSync(fd); } }
  function clearRecoveryProof(id) { rmSync(proofPath(id), { force: true }); syncParent(id); }
  function writeExecution(id, envelope) {
    const directory = executionRoot(id), target = executionPath(id, envelope.digest), temporary = `${target}.${random(8).toString("hex")}.tmp`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (existsSync(target)) {
      const existing = readExecution(id, envelope.digest);
      if (!existing.bytes.equals(envelope.bytes)) fail("external claim envelope differs", "ECLAIM");
      return existing;
    }
    let fd;
    try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, envelope.bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, target); syncParent(id); return envelope; }
    finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
  }
  function readExecution(id, digest) {
    try {
      const target = executionPath(id, digest), entry = lstatSync(target);
      if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600 || entry.size < 2 || entry.size > 400_000) fail("external claim envelope is corrupt", "ECLAIM");
      const envelope = validateHostExecutionEnvelope(readFileSync(target));
      if (envelope.bytes.length !== entry.size || envelope.digest !== digest) fail("external claim envelope changed", "ECLAIM");
      return envelope;
    } catch (error) { if (error?.code === "ENOENT") fail("external claim envelope is unavailable", "ECLAIM"); if (error?.code === "ECLAIM") throw error; fail("external claim envelope is corrupt", "ECLAIM"); }
  }
  function writeReport(id, report) {
    const directory = reportRoot(id), target = reportPath(id, report.digest), temporary = `${target}.${random(8).toString("hex")}.tmp`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (existsSync(target)) {
      const entry = lstatSync(target);
      if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600
        || entry.size !== report.bytes.length || !readFileSync(target).equals(report.bytes)) fail("external report differs", "EREPORT");
      return;
    }
    let fd;
    try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, report.bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, target); syncDirectory(directory); }
    finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
  }
  function sealedAuthority(id, value) {
    const keys = ["schema", "runId", "assignmentId", "itemRef", "itemRevision", "itemText", "frozenRecipe", "policy"];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every((key, index) => Object.keys(value)[index] === key)
      || value.schema !== "burnlist-loop-m12-run-authority@1" || value.runId !== id || !/^as1-sha256:[a-f0-9]{64}$/u.test(value.assignmentId)
      || !/^id1-sha256:[a-f0-9]{64}$/u.test(value.itemRevision) || typeof value.itemRef !== "string" || !value.itemRef
      || typeof value.itemText !== "string" || !value.itemText || Buffer.byteLength(value.itemText) > 65_536
      || typeof value.frozenRecipe !== "string" || typeof value.policy !== "string") fail("invalid sealed dispatch authority", "EAUTHORITY");
    for (const field of ["frozenRecipe", "policy"]) {
      const bytes = Buffer.from(value[field], "base64");
      if (!bytes.length || bytes.length > 262_144 || bytes.toString("base64") !== value[field]) fail("invalid sealed dispatch authority", "EAUTHORITY");
    }
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    if (bytes.length > 700_000) fail("sealed dispatch authority exceeds bounds", "EAUTHORITY");
    return Object.freeze({ value: Object.freeze({ ...value }), bytes });
  }
  function writeAuthorityAt(directory, id, value) {
    const sealed = sealedAuthority(id, value), target = join(directory, "dispatch-authority.json"), temporary = `${target}.${random(8).toString("hex")}.tmp`;
    let fd;
    try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, sealed.bytes); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, target); syncDirectory(directory); }
    finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
  }
  function readAuthority(id) {
    let fd;
    try {
      const target = authorityPath(id), entry = lstatSync(target);
      if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600 || entry.size < 2 || entry.size > 700_000) fail("sealed dispatch authority is corrupt", "EAUTHORITY");
      fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); const before = fstatSync(fd);
      if (!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino || before.size !== entry.size) fail("sealed dispatch authority changed while opening", "EAUTHORITY");
      const bytes = Buffer.alloc(before.size); if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) fail("sealed dispatch authority changed while reading", "EAUTHORITY");
      const after = fstatSync(fd), linked = lstatSync(target); if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || linked.isSymbolicLink() || linked.dev !== before.dev || linked.ino !== before.ino || linked.size !== before.size) fail("sealed dispatch authority changed while reading", "EAUTHORITY");
      const parsed = parseBoundedObject(bytes, { maximumBytes: 700_000, maximumDepth: 3, label: "sealed dispatch authority" });
      const sealed = sealedAuthority(id, parsed); if (!sealed.bytes.equals(bytes)) fail("sealed dispatch authority is not canonical", "EAUTHORITY"); return sealed.value;
    } catch (error) {
      if (error?.code === "ENOENT") fail("sealed dispatch authority is unavailable", "EAUTHORITY");
      if (error?.code === "EAUTHORITY") throw error;
      fail("sealed dispatch authority is corrupt", "EAUTHORITY");
    }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  function terminalizeCurrent(id, current, { kind = "exhausted", summary = "journal" } = {}, at = now()) {
    if (current.projection.sequence >= journalMaximum) fail("journal has no terminal capacity", "EJOURNAL");
    const selected = current.execution.system ?? (isTerminalState(current.projection.state) ? { kind: terminalKind[current.projection.state], summary: "journal-cleanup" } : { kind, summary }), targetState = isTerminalState(current.projection.state) ? current.projection.state : atomicTerminalState(selected.kind), targetNode = selected.kind === "converged" ? current.graph.nodes.find((node) => node.kind === "terminal" && node.state === "converged")?.id : current.graph.failurePolicy[selected.kind], alreadyStarted = current.execution.nodeId === targetNode && current.execution.started, attempt = alreadyStarted ? current.execution.attempts[targetNode] : (current.execution.attempts[targetNode] ?? 0) + 1, record = createJournalRecord({ sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, at, type: "terminal-node-committed", payload: { kind: selected.kind, summary: selected.summary, from: current.projection.state, to: targetState, nodeId: targetNode, attempt } });
    foldRun([...current.journal, record]); appendJournalRecord({ journalDirectory: journalFor(id), record }); clearRecoveryProof(id);
    return Object.freeze({ record, ...replay(id) });
  }
  const append = (id, lease, type, payload) => locked(id, () => { const current = replay(id); assertLease(current, lease); const at = now(); if (current.projection.sequence >= journalMaximum) fail("journal has no terminal capacity", "EJOURNAL"); const candidate = createJournalRecord({ sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, at, type, payload }), folded = foldRun([...current.journal, candidate]); if (type === "state-changed" && isTerminalState(payload.to)) return terminalizeCurrent(id, current, { kind: terminalKind[payload.to], summary: payload.cause }, at); if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current, {}, at); if (["node-started", "invocation-started", "invocation-result", "edge-taken"].includes(type) && folded.execution.budget.elapsedMilliseconds >= current.graph.budget.maxMinutes * 60_000) return terminalizeCurrent(id, current, { summary: "minutes" }, at); appendJournalRecord({ journalDirectory: journalFor(id), record: candidate }); return Object.freeze({ record: candidate, ...replay(id) }); });
  const acquireLease = (id) => locked(id, () => {
    let current = replay(id); if (current.execution.lease) fail("run already has a lease", "ELEASED"); if (isTerminalState(current.projection.state)) fail("run is terminal");
    const writes = ["prepared", "paused"].includes(current.projection.state) ? 2 : 1; if (!retainsTerminalReserve(current, writes)) return terminalizeCurrent(id, current);
    if (["prepared", "paused"].includes(current.projection.state)) { current = prospective(id, current, "state-changed", { from: current.projection.state, to: "running", cause: "control" }); }
    const lease = Object.freeze({ generation: current.execution.generation + 1, token: random(32).toString("hex") }), recoveryProof = random(32).toString("hex"); hooks.beforeProofPublish?.({ id, lease }); writeRecoveryProof(id, { generation: lease.generation, token: lease.token, recoveryProof }); hooks.afterProofPublish?.({ id, lease, recoveryProof }); try { prospective(id, current, "lease-acquired", lease); } catch (error) { clearRecoveryProof(id); throw error; } hooks.afterLeaseAppend?.({ id, lease, recoveryProof }); return Object.freeze({ lease, recoveryProof, ...replay(id) });
  });
  const releaseLease = (id, lease) => locked(id, () => { const current = replay(id); assertLease(current, lease); if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current); const result = prospective(id, current, "lease-released", { generation: lease?.generation, token: lease?.token }); clearRecoveryProof(id); return result; });
  const recoverLease = (id, proof) => locked(id, () => { const current = replay(id), expected = readRecoveryProof(id); if (!proof || proof.generation !== expected.generation || proof.recoveryProof !== expected.recoveryProof) fail("lost-owner proof is invalid", "ELOST_PROOF"); const held = current.execution.lease; if (!held || held.generation !== proof.generation || held.token !== expected.token) fail("owner generation changed", "ESTALE_LEASE"); if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current); const result = prospective(id, current, "lease-revoked", { generation: held.generation, token: held.token }); clearRecoveryProof(id); return result; });
  const terminalize = (id, lease, kind, summary) => locked(id, () => { const current = replay(id); assertLease(current, lease); return terminalizeCurrent(id, current, { kind, summary }); });
  const bindExternalClaim = (id, lease, { claim, envelope }) => locked(id, () => {
    const current = replay(id); assertLease(current, lease);
    if (current.execution.externalClaim) return readExternalClaim(id, current);
    if (current.execution.terminal || current.execution.started || current.execution.invocation || current.execution.node?.kind !== "agent") fail("current node is not an unstarted agent", "ECLAIM");
    const checkedClaim = validateHostClaim(claim), checkedEnvelope = validateHostExecutionEnvelope(envelope), authority = readAuthority(id), issued = now();
    const frozen = loadFrozenRecipe(Buffer.from(authority.frozenRecipe, "base64")), policy = loadBoundPolicy(Buffer.from(authority.policy, "base64"));
    if (hostClaimExpired(checkedClaim, issued) || checkedEnvelope.value.expiresAt <= issued || checkedClaim.executionDigest !== checkedEnvelope.digest
      || checkedClaim.runId !== id || checkedClaim.nodeId !== current.execution.nodeId || checkedClaim.attempt !== current.execution.attempt + 1
      || checkedClaim.assignmentId !== authority.assignmentId || checkedClaim.claimId !== checkedEnvelope.value.claimId
      || checkedClaim.assignmentId !== checkedEnvelope.value.assignmentId || checkedClaim.inputCandidate !== checkedEnvelope.value.inputCandidate
      || checkedEnvelope.value.nodeId !== checkedClaim.nodeId || checkedEnvelope.value.attempt !== checkedClaim.attempt
      || checkedEnvelope.value.recipeRevision !== frozen.revisions.executable || checkedEnvelope.value.policyRevision !== policy.revision) fail("external claim does not bind the current Run", "ECLAIM");
    if (current.execution.node.mode === "review" && checkedClaim.inputCandidate !== current.execution.candidate?.id)
      fail("review claim is not bound to the current candidate", "ECLAIM");
    writeExecution(id, checkedEnvelope);
    // One journal record makes the host-visible claim indivisible: replay never
    // observes a started agent invocation that lacks its sealed host envelope.
    prospective(id, current, "external-claim-bound", { claim: checkedClaim, envelopeDigest: checkedEnvelope.digest, invocationId: checkedEnvelope.value.invocationId });
    return readExternalClaim(id, replay(id));
  });
  function readExternalClaim(id, current = replay(id)) {
    const binding = current.execution.externalClaim;
    if (!binding) return null;
    const envelope = readExecution(id, binding.envelopeDigest);
    if (envelope.digest !== binding.envelopeDigest || envelope.value.claimId !== binding.claim.claimId
      || envelope.value.runId !== binding.claim.runId || envelope.value.nodeId !== binding.claim.nodeId
      || envelope.value.attempt !== binding.claim.attempt || envelope.value.assignmentId !== binding.claim.assignmentId
      || envelope.value.inputCandidate !== binding.claim.inputCandidate || envelope.value.expiresAt !== binding.claim.expiresAt) fail("external claim envelope does not match journal", "ECLAIM");
    return Object.freeze({ claim: binding.claim, envelope: envelope.bytes });
  }
  const abandonExternalClaim = (id, lease, abandonment) => locked(id, () => {
    const current = replay(id); assertLease(current, lease); const active = readExternalClaim(id, current);
    if (!active) fail("external claim is unavailable", "ECLAIM");
    const checked = createHostClaimAbandonment(abandonment), claim = active.claim;
    if (["runId", "claimId", "nodeId", "attempt", "assignmentId", "inputCandidate", "executionDigest", "expiresAt"].some((key) => checked[key] !== claim[key])
      || checked.reason === "expired" && !hostClaimExpired(claim, now())) fail("external claim abandonment is stale", "ECLAIM");
    return terminalizeCurrent(id, current, { kind: "lost", summary: `external claim ${checked.reason}` });
  });
  const resolveExternalClaim = (id, lease, { claimId, invocationId, reason }) => locked(id, () => {
    const current = replay(id); assertLease(current, lease);
    const active = readExternalClaim(id, current);
    if (!active || reason !== "paused" || active.claim.claimId !== claimId
      || current.execution.invocation?.invocationId !== invocationId) fail("external claim resolution is stale", "ECLAIM");
    return prospective(id, current, "external-claim-resolved", { claimId, invocationId, reason });
  });
  const acceptExternalReport = (id, lease, reportBytes, candidateForBoundary) => locked(id, () => {
    const current = replay(id);
    const raw = Buffer.from(reportBytes), parsed = parseBoundedObject(raw, { maximumBytes: 262_144, maximumDepth: 5, label: "host execution report" });
    const claimId = parsed?.result?.claimId;
    const bindingRecord = [...current.journal].reverse().find((record) => record.value.type === "external-claim-bound"
      && record.value.payload.claim.claimId === claimId);
    if (!bindingRecord) fail("external report claim is unavailable", "EREPORT");
    const binding = bindingRecord.value.payload, envelope = readExecution(id, binding.envelopeDigest);
    const boundary = typeof candidateForBoundary === "function" ? candidateForBoundary() : candidateForBoundary;
    const taskBoundary = current.execution.node.mode === "task";
    const candidateId = boundary?.candidateId ?? (taskBoundary ? boundary?.id : null) ?? null;
    const candidateContext = boundary?.candidateContext ?? (taskBoundary ? boundary?.context : null) ?? null;
    const observedCandidateId = boundary?.observedCandidateId ?? (!taskBoundary ? boundary?.id : null) ?? null;
    const report = validateHostExecutionReport(raw, {
      envelope, mode: current.graph.nodes.find((node) => node.id === binding.claim.nodeId)?.mode,
      openFindings: current.execution.node.mode === "review" ? current.execution.openFindings : new Map(),
    });
    const prior = current.journal.find((record) => record.value.type === "external-report-accepted"
      && record.value.payload.claimId === claimId);
    if (prior && prior.value.payload.reportDigest !== report.digest) fail("external report conflicts with accepted report", "EREPORT");
    // A cut after edge-taken leaves the old lease in the journal.  The exact
    // report retry owns the durable transaction tail and must release it;
    // returning here would fence the next node forever.
    if (prior && current.execution.nodeId !== binding.claim.nodeId) {
      if (current.execution.lease) {
        assertLease(current, lease);
        if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current, { kind: "exhausted", summary: "journal" });
        prospective(id, current, "lease-released", { generation: lease.generation, token: lease.token });
        clearRecoveryProof(id);
      }
      return replay(id);
    }
    assertLease(current, lease);
    const active = prior ? null : readExternalClaim(id, current);
    if (!prior && (!active || active.claim.claimId !== claimId || hostClaimExpired(active.claim, now()))) fail("external report claim is stale", "EREPORT");
    const result = report.value.result;
    if (result.outcome === "complete") {
      if (!/^cm1-sha256:[a-f0-9]{64}$/u.test(candidateId) || typeof candidateContext !== "string" || !candidateContext) fail("completed task candidate is unavailable", "EREPORT");
      if (observedCandidateId !== null) fail("unexpected observed report candidate", "EREPORT");
    } else {
      if (candidateId !== null || candidateContext !== null) fail("unexpected report candidate", "EREPORT");
      if (current.execution.node.mode === "review") {
        if (!/^cm1-sha256:[a-f0-9]{64}$/u.test(observedCandidateId)
          || observedCandidateId !== binding.claim.inputCandidate
          || observedCandidateId !== current.execution.candidate?.id) fail("review report candidate drifted", "EREPORT");
      } else if (observedCandidateId !== null) fail("unexpected observed report candidate", "EREPORT");
    }
    // This operation is a durable tail, not a collection of independently
    // optional writes. Reserve report + optional candidate + edge + release
    // before committing its first semantic record. If it cannot fit, consume
    // the one retained terminal record instead of stranding the host lease.
    const remaining = (prior ? 0 : 1) + (result.outcome === "complete" && !current.execution.candidate ? 1 : 0) + 2;
    if (!retainsTerminalReserve(current, remaining)) return terminalizeCurrent(id, current, { kind: "exhausted", summary: "journal" });
    let advanced = current;
    if (!prior) {
      writeReport(id, report);
      advanced = prospective(id, current, "external-report-accepted", {
        claimId, reportDigest: report.digest, invocationId: result.invocationId, kind: result.outcome,
        summary: `host reported ${result.outcome}`, outputBytes: report.bytes.length,
        candidateId: current.execution.node.mode === "task" ? null : current.execution.candidate?.id ?? null,
        findings: result.findings, resolvedFindingIds: result.resolvedFindingIds, telemetry: report.value.telemetry,
      });
      hooks.afterExternalReportAccepted?.({ id, lease, claimId, reportDigest: report.digest });
    }
    if (result.outcome === "complete" && !advanced.execution.candidate) advanced = prospective(id, advanced, "candidate-bound", { candidateId, candidateContext });
    const edge = advanced.graph.edges.find((item) => item.from === advanced.execution.nodeId && item.on === result.outcome);
    if (!edge) fail("external report outcome has no declared edge", "EREPORT");
    advanced = prospective(id, advanced, "edge-taken", { from: edge.from, on: edge.on, to: edge.to });
    hooks.afterExternalEdgeTaken?.({ id, lease, claimId, edge });
    prospective(id, advanced, "lease-released", { generation: lease.generation, token: lease.token });
    clearRecoveryProof(id);
    return replay(id);
  });
  function createRun({ runId, itemRef, graph, authority = null, allowSupersedeConverged = false }) {
    assertId(runId); if (typeof itemRef !== "string" || !itemRef || itemRef.length > 512) fail("invalid creation input"); validateGraph(graph); initialize();
    const target = pathFor(runId), staging = join(runs, `.create-${random(8).toString("hex")}.tmp`);
    if (existsSync(target)) fail("run already exists", "EEXIST"); mkdirSync(staging, { recursive: false, mode: 0o700 });
    try {
      const current = authority ? sealedAuthority(runId, authority).value : null;
      if (authority) writeAuthorityAt(staging, runId, authority);
      writeInitialJournal({ runDirectory: staging, at: now(), payload: { schema: "burnlist-loop-m2-run@1", runId, itemRef, graph, authorityRequired: Boolean(authority) } });
      syncDirectory(staging);
      withDirectoryLock({ lockPath: currentLock, reclaimLiveAfterAge: false, errorFactory: () => fail("current Run binding is locked", "ELOCKED"), fn: () => {
        if (existsSync(target)) fail("run already exists", "EEXIST");
        if (current) {
          const entries = currentAuthority().read(), previous = entries.find((entry) => entry.itemRef === current.itemRef);
          if (previous) {
            if (previous.runId === runId && previous.assignmentId === current.assignmentId) {
              // A cut after durable reservation but before directory rename is
              // recovered only by the same sealed Run identity.
            } else {
              const prior = replay(previous.runId).projection;
              if (!["failed", "stopped", "budget-exhausted", "needs-human"].includes(prior.state)
                && !(prior.state === "converged" && allowSupersedeConverged)) fail("current Run is still executable", "ECURRENT");
              currentAuthority().write([...entries.filter((entry) => entry.itemRef !== current.itemRef), { itemRef: current.itemRef, runId, assignmentId: current.assignmentId }]);
            }
          } else {
            currentAuthority().write([...entries, { itemRef: current.itemRef, runId, assignmentId: current.assignmentId }]);
          }
        }
        hooks.beforeRunPublish?.({ runId, staging, target }); renameSync(staging, target); syncDirectory(runs);
      } });
      return replay(runId);
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
  }
  // Publication is observational: commit and release the journal lock before notifying readers.
  const published = (result) => { try { publishProjection(root, result); } catch {} return result; };
  function resolveClaimRef(claimId) {
    if (!/^cl1-sha256:[a-f0-9]{64}$/u.test(claimId)) fail("invalid ClaimRef", "ECLAIM");
    if (!existsSync(runs)) fail("ClaimRef is missing", "ECLAIM");
    const entries = readdirSync(runs, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
    if (entries.length > 128 || entries.some((entry) => !entry.isDirectory() || !/^[a-f0-9]+$/u.test(entry.name))) fail("run directory exceeds bounds", "EBOUNDS");
    const matches = [];
    for (const entry of entries) {
      const runId = Buffer.from(entry.name, "hex").toString("utf8");
      if (!isRunRef(runId) || Buffer.from(runId).toString("hex") !== entry.name) fail("run directory is corrupt", "EBOUNDS");
      const current = replay(runId), bound = current.journal.some((record) => record.value.type === "external-claim-bound"
        && record.value.payload.claim.claimId === claimId);
      if (!bound) continue;
      const accepted = current.journal.some((record) => record.value.type === "external-report-accepted"
        && record.value.payload.claimId === claimId);
      if (!accepted && current.execution.externalClaim?.claim.claimId !== claimId) fail("ClaimRef is stale", "ECLAIM");
      matches.push(runId);
    }
    if (!matches.length) fail("ClaimRef is missing", "ECLAIM");
    if (matches.length !== 1) fail("ClaimRef is ambiguous", "ECLAIM");
    return matches[0];
  }
  function visibleRunEntries() {
    if (!existsSync(runs)) return [];
    const entries = readdirSync(runs, { withFileTypes: true });
    const staging = entries.filter((entry) => /^\.create-[a-f0-9]{16}\.tmp$/u.test(entry.name));
    const visible = entries.filter((entry) => !/^\.create-[a-f0-9]{16}\.tmp$/u.test(entry.name));
    if (staging.length > 128 || visible.length > 128
      || entries.some((entry) => !entry.isDirectory()
        || !/^(?:[a-f0-9]+|\.create-[a-f0-9]{16}\.tmp)$/u.test(entry.name)))
      fail("run directory exceeds bounds", "EBOUNDS");
    return visible.sort((left, right) => left.name.localeCompare(right.name));
  }
  function listForItem(itemRef) {
    if (typeof itemRef !== "string" || !itemRef) fail("invalid item projection", "EBOUNDS");
    const output = [];
    for (const entry of visibleRunEntries()) {
      const runId = Buffer.from(entry.name, "hex").toString("utf8");
      if (!isRunRef(runId) || Buffer.from(runId).toString("hex") !== entry.name)
        fail("run directory is corrupt", "EBOUNDS");
      const journal = readJournal(journalFor(runId));
      if (journal[0]?.value?.payload?.itemRef === itemRef) output.push(replay(runId).projection);
    }
    return output;
  }
  return Object.freeze({ createRun: (...input) => published(createRun(...input)), replay, read: replay,
    append: (...input) => published(append(...input)), acquireLease: (...input) => published(acquireLease(...input)),
    releaseLease: (...input) => published(releaseLease(...input)), recoverLease: (...input) => published(recoverLease(...input)),
    terminalize: (...input) => published(terminalize(...input)), bindExternalClaim: (...input) => published(bindExternalClaim(...input)),
    readExternalClaim, abandonExternalClaim: (...input) => published(abandonExternalClaim(...input)),
    resolveExternalClaim: (...input) => published(resolveExternalClaim(...input)),
    acceptExternalReport: (...input) => published(acceptExternalReport(...input)), list: () => {
    return visibleRunEntries()
      .map((entry) => replay(Buffer.from(entry.name, "hex").toString("utf8")).projection);
  }, listForItem, resolveClaimRef, readAuthority, readCurrentRun(itemRef) { if (!existsSync(base)) return null; const values = currentAuthority().read().filter((entry) => entry.itemRef === itemRef); if (values.length > 1) fail("current Run binding is ambiguous", "ECURRENT"); return values[0] ?? null; }, paths: Object.freeze({ base, runs, pathFor, journalFor, authorityPath, executionPath, reportPath, currentPath: join(base, "current-runs.json") }) });
}
