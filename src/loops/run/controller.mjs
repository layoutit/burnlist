import { presentRun } from "./read-projection.mjs";
import { isRunRef } from "./run-ref.mjs";

const fail = (message, code = "ELOOP_CONTROL") => { throw Object.assign(new Error(`Loop control: ${message}`), { code }); };
const stable = (value) => `${JSON.stringify(value)}\n`;

/** Small foreground-only control boundary.  It owns no daemon or recovery policy. */
export function createLoopController({ store, runnerFor }) {
  if (!store?.read || !store?.list || !store?.acquireLease || !store?.terminalize) fail("invalid controller input");
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
  return Object.freeze({ list, inspect, status, pause, stop, run, reconcile, render: stable });
}
