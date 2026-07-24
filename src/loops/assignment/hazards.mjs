import { runStore } from "../run/run-store.mjs";
import { parseItemRef } from "./selectors.mjs";

const SAFE_TERMINALS = new Set(["failed", "stopped", "budget-exhausted", "needs-human"]);

export class LoopHazardError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}
function bad(code, message) { throw new LoopHazardError(code, message); }

/**
 * Production Run journals are the only direct-burn/unassign authority. A
 * converged Run deliberately remains hazardous until CLI completion consumes
 * it; terminal failure, stop, exhaustion, and needs-human histories are safe.
 */
export function repositoryHazardAuthority(repoRoot) {
  return ({ itemRef }) => {
    const item = parseItemRef(itemRef);
    const store = runStore(repoRoot); let runs, current;
    try { runs = store.list(); current = store.readCurrentRun(item.selector); }
    catch (error) { bad("E_LOOP_HAZARD_CORRUPT", error?.message ?? "production Run state is unreadable"); }
    if (!Array.isArray(runs)) bad("E_LOOP_HAZARD_CORRUPT", "production Run state is invalid");
    const matching = runs.filter((run) => run?.itemRef === item.selector);
    if (current && !matching.some((run) => run.runId === current.runId)) return [`unpublished current Run ${current.runId}`];
    if (matching.some((run) => typeof run.runId !== "string" || typeof run.state !== "string")) bad("E_LOOP_HAZARD_CORRUPT", "production Run projection is invalid");
    return matching.filter((run) => !SAFE_TERMINALS.has(run.state)).map((run) => {
      if (run.state === "converged") return `completion-pending Run ${run.runId}`;
      return `nonterminal Run ${run.runId}`;
    });
  };
}
