import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assignLoopItem } from "../assignment/assignment.mjs";
import { resolveLoopAuthority } from "../assignment/resolver.mjs";
import { compileLoopPackage } from "./compile.mjs";
import { createRunRunner } from "../run/runner.mjs";
import { runStore } from "../run/run-store.mjs";
import { renderResolvedLoopView } from "../view/render.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const itemRef = "item:260724-002#L2";
const runId = "run:01arz3ndektsv4rrffq69g5fav";

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), "burnlist-project-strategy-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const plan = join(repo, "notes", "burnlists", "inprogress", "260724-002");
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(plan, "burnlist.md"), "# Test\n\n## Active Checklist\n- [ ] L2 | Project strategy\n\n## Completed\n");
  cpSync(join(projectRoot, ".burnlist", "loops"), join(repo, ".burnlist", "loops"), { recursive: true });
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
