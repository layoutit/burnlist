import { presentRun } from "./read-projection.mjs";
import { isRunRef } from "./run-ref.mjs";
import { prepareHostClaim } from "./host-execution.mjs";
import { deriveCandidate } from "./candidate.mjs";

const fail = (message, code = "ELOOP_CONTROL") => { throw Object.assign(new Error(`Loop control: ${message}`), { code }); };
const stable = (value) => `${JSON.stringify(value)}\n`;

/** Small foreground-only control boundary.  It owns no daemon or recovery policy. */
export function createLoopController({ store, runnerFor, repoRoot = null }) {
  if (!store?.read || !store?.list || !store?.acquireLease || !store?.terminalize || !store?.bindExternalClaim || !store?.readExternalClaim || !store?.abandonExternalClaim || !store?.acceptExternalReport || !store?.resolveClaimRef) fail("invalid controller input");
  const check = (runId) => { if (!isRunRef(runId)) fail("invalid RunRef"); return runId; };
  const read = (runId) => store.read(check(runId));
  const inspect = (runId) => Object.freeze(presentRun(read(runId)));
  // Status is a compact public projection, never the internal fold object.
  // This keeps frozen Loop identity and journal timestamps available to CLI
  // users without exposing dispatch authority or invocation internals.
  const status = (runId) => Object.freeze({ ...presentRun(read(runId)), schema: "burnlist-loop-status@1" });
  const list = () => Object.freeze(store.list().map((run) => ({ schema: "burnlist-loop-status@1", ...run })));
  function idleLease(runId) {
    const current = read(runId);
    if (current.execution.terminal) fail("Run is terminal", "ETERMINAL");
    if (current.execution.lease) fail("Run has an active foreground owner", "ELEASED");
    return store.acquireLease(runId).lease;
  }
  function pause(runId) {
    const lease = idleLease(runId), current = read(runId);
    if (current.execution.invocation && !current.execution.result) fail("Run has an active invocation", "EACTIVE");
    store.append(runId, lease, "state-changed", { from: "running", to: "paused", cause: "control" });
    store.releaseLease(runId, lease); return inspect(runId);
  }
  function stop(runId) {
    const lease = idleLease(runId);
    return presentRun(store.terminalize(runId, lease, "cancelled", "control"));
  }
  /** Claiming is controller-owned: the journal lease serializes contenders and exact retries reread the same envelope. */
  function claim(runId) {
    check(runId); const current = read(runId), active = store.readExternalClaim(runId, current);
    if (active) fail("Run agent node is already claimed", "ECLAIMED");
    const lease = idleLease(runId);
    try {
      const prepared = prepareHostClaim({ repoRoot, replay: read(runId), authority: store.readAuthority(runId) });
      return store.bindExternalClaim(runId, lease, prepared);
    }
    catch (error) {
      // A failed preparation has not started a host. Releasing this private
      // controller lease makes the normal foreground owner available again.
      try { if (read(runId).execution.lease) store.releaseLease(runId, lease); } catch {}
      throw error;
    }
  }
  function report(claimRef, bytes) {
    const runId = store.resolveClaimRef(claimRef), current = read(runId);
    return presentRun(store.acceptExternalReport(runId, current.execution.lease, bytes,
      () => deriveCandidate({ repoRoot })));
  }
  function readClaim(runId) { check(runId); return store.readExternalClaim(runId); }
  function abandonClaim(runId, abandonment) {
    check(runId); const current = read(runId);
    if (current.execution.terminal) return inspect(runId);
    if (current.execution.externalClaim) {
      if (!current.execution.lease) fail("external claim owner is not fenced", "ELEASED");
      return presentRun(store.abandonExternalClaim(runId, current.execution.lease, abandonment));
    }
    const lease = idleLease(runId);
    return presentRun(store.abandonExternalClaim(runId, lease, abandonment));
  }
  async function run(runId) {
    check(runId); if (typeof runnerFor !== "function") fail("foreground runner is unavailable", "ERUNNER_UNAVAILABLE");
    const runner = runnerFor(runId); if (!runner?.run) fail("foreground runner is unavailable", "ERUNNER_UNAVAILABLE");
    return presentRun(await runner.run());
  }
  /** Recovery is deliberately proof-gated: without an owner proof it cannot take a live lease. */
  function reconcile(runId, recoveryProof = null) {
    check(runId); const current = read(runId);
    if (current.execution.terminal || !current.execution.lease) return inspect(runId);
    if (!current.execution.invocation || !recoveryProof) fail("active owner is not demonstrably lost", "ELOST_PROOF");
    store.recoverLease(runId, recoveryProof);
    const lease = idleLease(runId);
    return presentRun(store.terminalize(runId, lease, "lost", "reconciled lost invocation"));
  }
  return Object.freeze({ list, inspect, status, pause, stop, run, reconcile, claim, report, readClaim, abandonClaim, render: stable });
}
