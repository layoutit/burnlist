import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findBurnlistDir } from "../../cli/lifecycle-moves.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { locateItemSpan, validateAssignedItem } from "./item-metadata.mjs";
import { resolveBuiltin } from "./assignment.mjs";
import { parseItemRef, parseLoopRef, parseRunRef, selectorKind } from "./selectors.mjs";
import { assignmentStore } from "./store.mjs";

export class LoopResolutionError extends Error { constructor(code, message) { super(`${code}: ${message}`); this.code = code; } }
function fail(code, message) { throw new LoopResolutionError(code, message); }
function assigned(repoRoot, item) {
  let found; try { found = findBurnlistDir(repoRoot, item.burnlistId); } catch (error) { fail("E_ITEM_MISSING", error.message); }
  let span; try { span = locateItemSpan(readFileSync(join(found.dir, "burnlist.md")), item.itemId); } catch (error) { fail("E_ITEM_MISSING", error.message); }
  let meta; try { meta = validateAssignedItem(item.selector, span); } catch (error) { fail("E_ASSIGNMENT_INVALID", error.message); }
  return { found, meta };
}
function pinUnavailable(meta, current) {
  const pinned = meta["Execution-Revision"], currentRevision = current?.revisions?.executable ?? "unavailable";
  fail("ELOOP_PIN_BYTES_UNAVAILABLE", `pinned=${pinned} current=${currentRevision}; restore the assignment artifact or safely unassign and reassign the item`);
}

/** One selector-to-authority boundary. It never falls through between kinds. */
export async function resolveLoopAuthority({ repoRoot, selector, runReader }) {
  let kind; try { kind = selectorKind(selector, { allowViewSugar: true }); }
  catch (error) { fail("E_LOOP_SELECTOR_INVALID", error.message); }
  if (kind === "loop") {
    const loop = parseLoopRef(selector, { allowViewSugar: true }); let compiled;
    try { compiled = await resolveBuiltin(loop); } catch (error) { fail("E_LOOP_MISSING", error.message); }
    return { authority: "UNPINNED", selector: loop.selector, compiled, executableRevision: compiled.revisions.executable };
  }
  if (kind === "item") {
    const item = parseItemRef(selector), value = assigned(repoRoot, item);
    let current = null; try { current = await resolveBuiltin(parseLoopRef(value.meta.Selector)); } catch { /* pin remains authoritative */ }
    let artifact; try { artifact = assignmentStore(repoRoot).load(value.meta["Assignment-Id"]); } catch { pinUnavailable(value.meta, current); }
    if (artifact.itemRef !== item.selector || artifact.assignmentId !== value.meta["Assignment-Id"] || artifact.assignedItemDigest !== value.meta.assignedDigest || artifact.unassignedItemDigest !== value.meta.unassignedDigest || artifact.executionRevision !== value.meta["Execution-Revision"] || artifact.packageRevision !== value.meta["Package-Revision"]) pinUnavailable(value.meta, current);
    // The assignment artifact remains the only executable authority.  The fresh
    // compilation is deliberately complete (rather than just a revision) so a
    // view can show provenance drift without ever substituting its graph.
    return { authority: "ITEM-PINNED", selector: item.selector, loopRef: artifact.selector,
      assignment: value.meta, artifact, executableRevision: artifact.executionRevision,
      currentCompiled: current, currentExecutableRevision: current?.revisions.executable ?? null,
      executableDrift: current ? current.revisions.executable !== artifact.executionRevision : null };
  }
  const run = parseRunRef(selector);
  if (typeof runReader !== "function") fail("E_RUN_UNAVAILABLE", "Run-frozen authority is unavailable before the Run store is installed");
  let record; try { record = await runReader(run.selector); } catch (error) { fail("E_RUN_MISSING", error.message); }
  if (!record || record.runId !== run.selector || !Buffer.isBuffer(record.frozenRecipe)) fail("E_RUN_CORRUPT", "Run reader did not return a verified frozen recipe");
  let frozen; try { frozen = loadFrozenRecipe(record.frozenRecipe); } catch (error) { fail("E_RUN_CORRUPT", error.message); }
  return { authority: "RUN-FROZEN", selector: run.selector, loopRef: `loop:builtin:${frozen.ir.id}`,
    run: record, frozen, executableRevision: frozen.revisions.executable };
}

export function selectNonterminalRun(itemRef, runs) {
  const item = parseItemRef(itemRef); if (!Array.isArray(runs)) fail("E_RUN_CORRUPT", "Run list is unavailable");
  const active = runs.filter((run) => run?.itemRef === item.selector && ["prepared", "running", "pausing", "paused", "quarantined", "converged-pending-completion", "completion-needs-human"].includes(run.state));
  if (active.length !== 1) fail("E_RUN_AMBIGUOUS", `${active.length ? "multiple" : "no"} nonterminal Runs: ${active.slice(0, 8).map((run) => run.runId).join(",")}`);
  parseRunRef(active[0].runId); return active[0];
}
