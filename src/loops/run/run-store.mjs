import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

const fail = (message, code = "ERUN_STORE") => { throw Object.assign(new Error(`Run store: ${message}`), { code }); };
const runName = (id) => Buffer.from(id).toString("hex");
export function runStore(repoRoot, { clock = () => Date.now(), random = randomBytes, hooks = {}, publishProjection = publishLoopProjectionInvalidation } = {}) {
  const root = resolve(repoRoot), base = join(root, ".local", "burnlist", "loop", "m2"), runs = join(base, "runs"), now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail("invalid clock"); return value; };
  const pathFor = (id) => join(runs, runName(id)), journalFor = (id) => join(pathFor(id), "journal"), lockFor = (id) => join(pathFor(id), ".lock"), proofPath = (id) => join(pathFor(id), ".recovery-proof"), authorityPath = (id) => join(pathFor(id), "dispatch-authority.json"), currentLock = join(base, ".current-runs.lock"), initialize = () => mkdirSync(runs, { recursive: true, mode: 0o700 }), currentAuthority = () => currentRunAuthority({ root, base, random });
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
  const retainsTerminalReserve = (current, writes = 1) => current.projection.sequence + writes < MAX_JOURNAL_RECORDS;
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
    if (current.projection.sequence >= MAX_JOURNAL_RECORDS) fail("journal has no terminal capacity", "EJOURNAL");
    const selected = current.execution.system ?? (isTerminalState(current.projection.state) ? { kind: terminalKind[current.projection.state], summary: "journal-cleanup" } : { kind, summary }), targetState = isTerminalState(current.projection.state) ? current.projection.state : atomicTerminalState(selected.kind), targetNode = selected.kind === "converged" ? current.graph.nodes.find((node) => node.kind === "terminal" && node.state === "converged")?.id : current.graph.failurePolicy[selected.kind], alreadyStarted = current.execution.nodeId === targetNode && current.execution.started, attempt = alreadyStarted ? current.execution.attempts[targetNode] : (current.execution.attempts[targetNode] ?? 0) + 1, record = createJournalRecord({ sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, at, type: "terminal-node-committed", payload: { kind: selected.kind, summary: selected.summary, from: current.projection.state, to: targetState, nodeId: targetNode, attempt } });
    foldRun([...current.journal, record]); appendJournalRecord({ journalDirectory: journalFor(id), record }); clearRecoveryProof(id);
    return Object.freeze({ record, ...replay(id) });
  }
  const append = (id, lease, type, payload) => locked(id, () => { const current = replay(id); assertLease(current, lease); const at = now(); if (current.projection.sequence >= MAX_JOURNAL_RECORDS) fail("journal has no terminal capacity", "EJOURNAL"); const candidate = createJournalRecord({ sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, at, type, payload }), folded = foldRun([...current.journal, candidate]); if (type === "state-changed" && isTerminalState(payload.to)) return terminalizeCurrent(id, current, { kind: terminalKind[payload.to], summary: payload.cause }, at); if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current, {}, at); if (["node-started", "invocation-started", "invocation-result", "edge-taken"].includes(type) && folded.execution.budget.elapsedMilliseconds >= current.graph.budget.maxMinutes * 60_000) return terminalizeCurrent(id, current, { summary: "minutes" }, at); appendJournalRecord({ journalDirectory: journalFor(id), record: candidate }); return Object.freeze({ record: candidate, ...replay(id) }); });
  const acquireLease = (id) => locked(id, () => {
    let current = replay(id); if (current.execution.lease) fail("run already has a lease", "ELEASED"); if (isTerminalState(current.projection.state)) fail("run is terminal");
    const writes = ["prepared", "paused"].includes(current.projection.state) ? 2 : 1; if (!retainsTerminalReserve(current, writes)) return terminalizeCurrent(id, current);
    if (["prepared", "paused"].includes(current.projection.state)) { current = prospective(id, current, "state-changed", { from: current.projection.state, to: "running", cause: "control" }); }
    const lease = Object.freeze({ generation: current.execution.generation + 1, token: random(32).toString("hex") }), recoveryProof = random(32).toString("hex"); hooks.beforeProofPublish?.({ id, lease }); writeRecoveryProof(id, { generation: lease.generation, token: lease.token, recoveryProof }); hooks.afterProofPublish?.({ id, lease, recoveryProof }); try { prospective(id, current, "lease-acquired", lease); } catch (error) { clearRecoveryProof(id); throw error; } hooks.afterLeaseAppend?.({ id, lease, recoveryProof }); return Object.freeze({ lease, recoveryProof, ...replay(id) });
  });
  const releaseLease = (id, lease) => locked(id, () => { const current = replay(id); assertLease(current, lease); if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current); const result = prospective(id, current, "lease-released", { generation: lease?.generation, token: lease?.token }); clearRecoveryProof(id); return result; });
  const recoverLease = (id, proof) => locked(id, () => { const current = replay(id), expected = readRecoveryProof(id); if (!proof || proof.generation !== expected.generation || proof.recoveryProof !== expected.recoveryProof) fail("lost-owner proof is invalid", "ELOST_PROOF"); const held = current.execution.lease; if (!held || held.generation !== proof.generation || held.token !== expected.token) fail("owner generation changed", "ESTALE_LEASE"); if (!retainsTerminalReserve(current)) return terminalizeCurrent(id, current); const result = prospective(id, current, "lease-revoked", { generation: held.generation, token: held.token }); clearRecoveryProof(id); return result; });
  const terminalize = (id, lease, kind, summary) => locked(id, () => { const current = replay(id); assertLease(current, lease); return terminalizeCurrent(id, current, { kind, summary }); });
  function createRun({ runId, itemRef, graph, authority = null }) {
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
              if (!["failed", "stopped", "budget-exhausted", "needs-human"].includes(prior.state)) fail("current Run is still executable", "ECURRENT");
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
  return Object.freeze({ createRun: (...input) => published(createRun(...input)), replay, read: replay,
    append: (...input) => published(append(...input)), acquireLease: (...input) => published(acquireLease(...input)),
    releaseLease: (...input) => published(releaseLease(...input)), recoverLease: (...input) => published(recoverLease(...input)),
    terminalize: (...input) => published(terminalize(...input)), list: () => {
    if (!existsSync(runs)) return [];
    const entries = readdirSync(runs, { withFileTypes: true }), staging = entries.filter((entry) => /^\.create-[a-f0-9]{16}\.tmp$/u.test(entry.name)), visible = entries.filter((entry) => !/^\.create-[a-f0-9]{16}\.tmp$/u.test(entry.name));
    if (staging.length > 128 || visible.length > 128 || entries.some((entry) => !entry.isDirectory() || !/^(?:[a-f0-9]+|\.create-[a-f0-9]{16}\.tmp)$/u.test(entry.name))) fail("run directory exceeds bounds", "EBOUNDS");
    return visible.sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => replay(Buffer.from(entry.name, "hex").toString("utf8")).projection);
  }, readAuthority, readCurrentRun(itemRef) { if (!existsSync(base)) return null; const values = currentAuthority().read().filter((entry) => entry.itemRef === itemRef); if (values.length > 1) fail("current Run binding is ambiguous", "ECURRENT"); return values[0] ?? null; }, paths: Object.freeze({ base, runs, pathFor, journalFor, authorityPath, currentPath: join(base, "current-runs.json") }) });
}
