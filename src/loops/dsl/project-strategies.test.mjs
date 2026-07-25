import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assignLoopItem } from "../assignment/assignment.mjs";
import { resolveLoopAuthority } from "../assignment/resolver.mjs";
import { compileLoopPackage } from "./compile.mjs";
import { createRunRunner as createCoreRunRunner } from "../run/runner.mjs";
import { runStore } from "../run/run-store.mjs";
import { renderResolvedLoopView } from "../view/render.mjs";

const itemRef = "item:260724-002#L2";
const runId = "run:01arz3ndektsv4rrffq69g5fav";
const terminals = `<gate id="converged" kind="convergence" requires="final-validate,final-review"/><terminal id="completed" state="converged"/><terminal id="needs-human" state="needs-human"/><terminal id="failed" state="failed"/><terminal id="stopped" state="stopped"/><terminal id="exhausted" state="budget-exhausted"/><failure-policy error="failed" timeout="failed" cancelled="stopped" lost="needs-human" exhausted="exhausted"/>`;
const finish = `<edge from="integrate" on="complete" to="final-validate"/><edge from="final-validate" on="pass" to="final-review"/><edge from="final-validate" on="fail" to="integrate" max-visits="3"/><edge from="final-review" on="approve" to="converged"/><edge from="final-review" on="reject" to="integrate" max-visits="3"/><edge from="final-review" on="escalate" to="needs-human"/><edge from="converged" on="pass" to="completed"/><edge from="converged" on="fail" to="needs-human"/>`;
const sharedEnd = `<agent id="integrate" mode="task" execution="host" intelligence="strong" role="maker" route="implementation.standard" authority="write" instructions="integrate"/><check id="final-validate" capability="repo-verify"/><agent id="final-review" mode="review" execution="host" intelligence="critical" role="reviewer" route="review.strong" authority="read" independent-from="integrate" requires="fresh-session:enforced,filesystem-write-deny:supervised" instructions="final-review"/>`;
const createRunRunner = (options) => createCoreRunRunner({
  ...options,
  allowTestAgentExecution: true,
});

function strategyPackage(name) {
  if (name === "whole-first") {
    const agents = `<agent id="implement" mode="task" execution="host" intelligence="standard" role="maker" route="implementation.standard" authority="write" instructions="implement"/><check id="validate" capability="repo-verify"/><agent id="review" mode="review" execution="host" intelligence="strong" role="reviewer" route="review.strong" authority="read" independent-from="implement" requires="fresh-session:enforced,filesystem-write-deny:supervised" instructions="review"/><agent id="refine" mode="task" execution="host" intelligence="standard" role="maker" route="implementation.standard" authority="write" instructions="refine"/>${sharedEnd}`;
    const edges = `<edge from="implement" on="complete" to="validate"/><edge from="validate" on="pass" to="review"/><edge from="validate" on="fail" to="refine"/><edge from="review" on="approve" to="integrate"/><edge from="review" on="reject" to="refine"/><edge from="review" on="escalate" to="needs-human"/><edge from="refine" on="complete" to="validate" max-visits="3"/>${finish.replaceAll('to="integrate" max-visits="3"', 'to="refine"')}`;
    return { entry: "implement", budget: [8, 90, 12, 8, 32], agents, edges,
      instructions: ["implement", "review", "refine", "integrate", "final-review"] };
  }
  const agents = [`<agent id="plan-blocks" mode="task" execution="host" intelligence="strong" role="maker" route="implementation.standard" authority="write" instructions="plan-blocks"/>`];
  const edges = [`<edge from="plan-blocks" on="complete" to="implement-block-1"/>`];
  const instructions = ["plan-blocks"];
  for (const index of [1, 2, 3]) {
    agents.push(`<agent id="implement-block-${index}" mode="task" execution="host" intelligence="fast" role="maker" route="implementation.standard" authority="write" instructions="implement-block-${index}"/><check id="validate-block-${index}" capability="repo-verify"/><agent id="review-block-${index}" mode="review" execution="host" intelligence="standard" role="reviewer" route="review.strong" authority="read" independent-from="implement-block-${index}" requires="fresh-session:enforced,filesystem-write-deny:supervised" instructions="review-block-${index}"/>`);
    edges.push(`<edge from="implement-block-${index}" on="complete" to="validate-block-${index}"/><edge from="validate-block-${index}" on="pass" to="review-block-${index}"/><edge from="validate-block-${index}" on="fail" to="implement-block-${index}" max-visits="3"/><edge from="review-block-${index}" on="approve" to="${index === 3 ? "integrate" : `implement-block-${index + 1}`}"/><edge from="review-block-${index}" on="reject" to="implement-block-${index}" max-visits="3"/><edge from="review-block-${index}" on="escalate" to="needs-human"/>`);
    instructions.push(`implement-block-${index}`, `review-block-${index}`);
  }
  return { entry: "plan-blocks", budget: [14, 120, 24, 12, 56], agents: `${agents.join("")}${sharedEnd}`,
    edges: `${edges.join("")}${finish}`, instructions: [...instructions, "integrate", "final-review"] };
}

function writeStrategy(repo, name) {
  const value = strategyPackage(name), directory = join(repo, ".burnlist", "loops", name);
  mkdirSync(directory, { recursive: true });
  const [rounds, minutes, agents, checks, transitions] = value.budget;
  writeFileSync(join(directory, `${name}.loop`), `<loop id="${name}" version="0.1.0" entry="${value.entry}"><budget max-rounds="${rounds}" max-minutes="${minutes}" max-agent-runs="${agents}" max-check-runs="${checks}" max-transitions="${transitions}" max-output-bytes="262144"/>${value.agents}${terminals}${value.edges}</loop>\n`);
  writeFileSync(join(directory, "instructions.md"), `${value.instructions.map((id) => `## ${id}\nExercise the bounded ${id} responsibility.\n`).join("\n")}\n`);
}

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), "burnlist-project-strategy-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const plan = join(repo, "notes", "burnlists", "inprogress", "260724-002");
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(plan, "burnlist.md"), "# Test\n\n## Active Checklist\n- [ ] L2 | Project strategy\n\n## Completed\n");
  writeStrategy(repo, "whole-first");
  writeStrategy(repo, "block-by-block");
  return repo;
}

function outcome(nodeId, wholeFirst, attempts) {
  if (nodeId.includes("validate")) return "pass";
  if (nodeId.includes("review")) return wholeFirst && nodeId === "review" && attempts === 1 ? "reject" : "approve";
  return "complete";
}

async function runGraph(repo, graph, wholeFirst) {
  const store = runStore(repo);
  store.createRun({ runId, itemRef, graph });
  const seen = [];
  const runner = createRunRunner({ store, runId, invoke: async ({ nodeId }) => {
    seen.push(nodeId);
    return { kind: outcome(nodeId, wholeFirst, seen.filter((id) => id === nodeId).length), summary: nodeId, outputBytes: 0, candidateId: null };
  } });
  const result = await runner.run();
  return { result, seen };
}

for (const [name, wholeFirst] of [["whole-first", true], ["block-by-block", false]]) {
  test(`${name} is a project-local serial Loop that compiles, assigns, executes, and renders`, async (t) => {
    const repo = fixture(t);
    const directory = join(repo, ".burnlist", "loops", name);
    const compiled = await compileLoopPackage(directory, { loopFile: `${name}.loop` });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));

    await assignLoopItem({ repoRoot: repo, itemRef, loopRef: `loop:project:${name}` });
    assert.match(readFileSync(join(repo, "notes", "burnlists", "inprogress", "260724-002", "burnlist.md"), "utf8"), new RegExp(`Selector: loop:project:${name}`, "u"));
    const authority = await resolveLoopAuthority({ repoRoot: repo, selector: itemRef });
    const rendered = renderResolvedLoopView(authority);
    assert.match(rendered, new RegExp(`LOOP: loop:project:${name}`, "u"));

    const { result, seen } = await runGraph(repo, compiled.ir, wholeFirst);
    assert.equal(result.projection.state, "converged");
    assert.match(rendered, /DRAWING \(DECORATIVE\):/u);
    if (wholeFirst) {
      assert.deepEqual(seen, ["implement", "validate", "review", "refine", "validate", "review", "integrate", "final-validate", "final-review"]);
      const refine = compiled.ir.edges.filter((edge) => edge.to === "refine");
      assert.deepEqual(refine.map((edge) => `${edge.from}/${edge.on}`).sort(), ["final-review/reject", "final-validate/fail", "review/reject", "validate/fail"]);
    } else {
      assert.deepEqual(seen, ["plan-blocks", "implement-block-1", "validate-block-1", "review-block-1", "implement-block-2", "validate-block-2", "review-block-2", "implement-block-3", "validate-block-3", "review-block-3", "integrate", "final-validate", "final-review"]);
      for (const index of [1, 2, 3]) {
        const review = `review-block-${index}`;
        const approved = compiled.ir.edges.find((edge) => edge.from === review && edge.on === "approve");
        assert.equal(approved?.to, index === 3 ? "integrate" : `implement-block-${index + 1}`);
      }
    }
  });
}
