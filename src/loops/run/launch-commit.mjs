import { join } from "node:path";
import { withLock, findBurnlistDir } from "../../cli/lifecycle-moves.mjs";
import { withDirectoryLock } from "../../server/dir-lock.mjs";
import { parseItemRef } from "../assignment/selectors.mjs";
import { configRoot } from "../config/store.mjs";
import { prefixed } from "../dsl/hash.mjs";
import { foldStateMachine, selectRunnableNode } from "./state-machine.mjs";

function fail(message) { throw Object.assign(new Error(`Loop launch: ${message}`), { code: "ELOOP_RUNNER" }); }
function invocationId({ claimId, counter }) {
  return prefixed("iv1-sha256:", "invocation-v1", [Buffer.from(claimId), Buffer.from(String(counter))]);
}

/** One closed lifecycle -> config -> Run-journal launch transaction. */
export function createLaunchCommit({ repoRoot, replayRaw, journalLockPath, appendLocked, withCatalog, capture, recheck, hold, release }) {
  return function commitLaunch(runId, input) {
    if (!input || Object.keys(input).length !== 2 || typeof input.nodeId !== "string"
      || !input.clockSample || typeof input.clockSample !== "object") fail("invalid launch request");
    const initial = replayRaw(runId);
    const item = parseItemRef(initial.projection.itemRef);
    const plan = findBurnlistDir(repoRoot, item.burnlistId);
    return withLock(plan.dir, () => withDirectoryLock({
      lockPath: join(configRoot(repoRoot), ".config.lock"), reclaimLiveAfterAge: false,
      errorFactory: () => fail("Loop configuration is locked"), fn: () => withCatalog(() => withDirectoryLock({
        lockPath: journalLockPath(runId), reclaimLiveAfterAge: false,
        errorFactory: () => fail("Run journal is locked"), fn() {
          let current = replayRaw(runId); const captured = capture({ repoRoot, replay: current });
          appendLocked(runId, { type: "clock-sampled", payload: input.clockSample,
            expectedSequence: current.projection.sequence + 1, expectedPrevDigest: current.projection.journalDigest });
          current = replayRaw(runId);
          const state = foldStateMachine({ ir: current.frozenRecipe.ir, records: current.journal });
          const selected = selectRunnableNode({ ir: current.frozenRecipe.ir, records: current.journal });
          if (selected.kind === "exhausted") return Object.freeze({ kind: "exhausted", reason: selected.reason });
          if (selected.kind !== "spawn" || selected.node.id !== input.nodeId || !state.owner)
            fail("spawn has no committed current entry");
          const counter = selected.node.kind === "agent"
            ? state.budget.counters.agentRuns + 1 : state.budget.counters.checkRuns + 1;
          const id = invocationId({ claimId: state.owner.claimId, counter });
          let held = [];
          try {
            const committed = appendLocked(runId, { type: "spawn-intent", payload: {
              schema: "burnlist-loop-spawn-intent@1", nodeId: input.nodeId, attempt: selected.attempt,
              claimId: state.owner.claimId, invocationId: id, launchAuthorityDigest: captured.authorityDigest,
            }, expectedSequence: current.projection.sequence + 1, expectedPrevDigest: current.projection.journalDigest,
            hooks: { beforePublish() {
              // This is a detected-at-publication boundary, not an OS execution claim.
              // L9 must compare launchAuthorityDigest while binding the real process.
              recheck(captured); held = hold(captured); recheck(captured);
            } } });
            return Object.freeze({ kind: "spawned", invocationId: id, committed });
          } finally { release(held); }
        },
      })),
    }));
  };
}
