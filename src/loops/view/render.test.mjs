import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LoopViewError, renderResolvedLoopView } from "./render.mjs";

const ir = JSON.parse(readFileSync(new URL("../dsl/__fixtures__/review.ir.json", import.meta.url)));
const revisions = JSON.parse(readFileSync(new URL("../dsl/__fixtures__/review.revisions.json", import.meta.url)));
const compiled = { ir, revisions };
const base = { authority: "UNPINNED", selector: "loop:builtin:review", compiled };

function outputDigest(value) { return createHash("sha256").update(value).digest("hex"); }

test("renders the closed review graph byte-deterministically", () => {
  const output = renderResolvedLoopView(base);
  assert.equal(outputDigest(output), "cf8421f1e0c0017178e1563e75a7cd42455fdc0106bff862410916d9cf3cb0b9");
  assert.equal(output, renderResolvedLoopView({ ...base, terminalWidth: 1 }));
  assert.match(output, /^BURNLIST LOOP VIEW @1\nMODE: UNPINNED/m);
  assert.match(output, /DRAWING \(DECORATIVE\):\n  \* implement --complete--> verify\n(?:  .+\n)+ADJACENCY \(AUTHORITATIVE\):/);
  for (const outcome of ["complete", "pass", "fail", "approve", "reject", "escalate", "error", "timeout", "cancelled", "lost", "exhausted"]) assert.match(output, new RegExp(`^  ${outcome} -> `, "m"));
  assert.match(output, /^  reject -> implement \[class=semantic max-visits=3\]$/m);
  assert.match(output, /^implement \[kind=agent scc=5\]$/m);
  assert.match(output, /COMPLETION:\n  converged -> cli-completion -> completed\|completion-needs-human\nEND\n$/);
  assert.doesNotMatch(output, /\x1b|\r/);
});

test("renders each authority mode and item drift/unavailability", () => {
  const item = renderResolvedLoopView({ authority: "ITEM-PINNED", selector: "item:260722-001#review", artifact: { frozen: compiled } });
  assert.match(item, /MODE: ITEM-PINNED/);
  assert.match(item, /SOURCE: assigned=ls1-sha256:[a-f0-9]{64} current=unavailable status=unavailable/);
  const drift = renderResolvedLoopView({ authority: "ITEM-PINNED", selector: "item:260722-001#review", artifact: { frozen: compiled }, currentCompiled: { ir, revisions: { ...revisions, source: `ls1-sha256:${"a".repeat(64)}` } } });
  assert.match(drift, /SOURCE: assigned=ls1-sha256:[a-f0-9]{64} current=ls1-sha256:a{64} status=drift/);
  const frozen = renderResolvedLoopView({ authority: "RUN-FROZEN", selector: "run:0123456789abcdefghjkmnpqrs", frozen: compiled });
  assert.match(frozen, /MODE: RUN-FROZEN/);
  assert.match(frozen, /SOURCE: assigned=ls1-sha256:[a-f0-9]{64} current=not-checked status=not-checked/);
});

test("keeps item graph pinned while reporting complete current provenance", () => {
  const current = { ir, revisions: { source: `ls1-sha256:${"a".repeat(64)}`, package: `lp1-sha256:${"b".repeat(64)}`, executable: `er1-sha256:${"c".repeat(64)}` } };
  const output = renderResolvedLoopView({ authority: "ITEM-PINNED", selector: "item:260722-001#review", loopRef: "loop:builtin:review", artifact: { frozen: compiled }, currentCompiled: current });
  assert.match(output, new RegExp(`EXECUTION: assigned=${revisions.executable} current=er1-sha256:c{64} status=drift`));
  assert.match(output, /SOURCE: assigned=.* current=ls1-sha256:a{64} status=drift/);
  assert.match(output, /PACKAGE: assigned=.* current=lp1-sha256:b{64} status=drift/);
  assert.match(output, /^implement \[kind=agent scc=5\]$/m);
});

test("rejects malformed IR, control values, and oversized adjacency before returning", () => {
  assert.throws(() => renderResolvedLoopView({ ...base, compiled: { ir: { ...ir, compiler: "unsupported" }, revisions } }), (error) => error instanceof LoopViewError && error.code === "ELOOP_VIEW_IR_INVALID");
  assert.throws(() => renderResolvedLoopView({ ...base, selector: "loop:builtin:review\nansi" }), (error) => error.code === "ELOOP_VIEW_VALUE");
  const tooMany = { ...ir, nodes: ir.nodes.map((node) => ({ ...node, id: `${node.id}-${"x".repeat(65500)}` })) };
  assert.throws(() => renderResolvedLoopView({ ...base, compiled: { ir: tooMany, revisions } }), (error) => error.code === "ELOOP_VIEW_IR_INVALID");
  assert.throws(() => renderResolvedLoopView({ ...base, selector: `loop:builtin:${"x".repeat(300000)}` }), (error) => error.code === "ELOOP_VIEW_OUTPUT_CAP");
});
