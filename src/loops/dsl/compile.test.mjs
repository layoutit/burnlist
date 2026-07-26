import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileLoopFiles, compileLoopPackage } from "./compile.mjs";
import { freezeRecipe, loadFrozenRecipe } from "./frozen.mjs";
import { canonicalIrBytes } from "./canonical.mjs";
import { prefixed } from "./hash.mjs";
import { validateClosedIr, validateReplayIr } from "./ir-validate.mjs";
import { createJournalRecord } from "../run/run-journal.mjs";
import { foldRun } from "../run/run-fold.mjs";
import { created } from "../run/m2-test-fixtures.mjs";
import { renderDiagnostics } from "./diagnostics.mjs";

const root = new URL("./__fixtures__/compiler-review/", import.meta.url);
const fixtures = new URL("./__fixtures__/", import.meta.url);
async function reviewFiles() { return { "review.loop": await readFile(new URL("review.loop", root)), "instructions.md": await readFile(new URL("instructions.md", root)) }; }
async function compiled() { const result = compileLoopFiles(await reviewFiles()); assert.equal(result.ok, true, renderDiagnostics(result.diagnostics ?? [])); return result; }

test("built-in review package compiles to deterministic canonical frozen IR", async () => {
  const first = await compiled(), second = await compiled();
  const goldenIr = await readFile(new URL("review.ir.json", fixtures)), goldenRevisions = JSON.parse(await readFile(new URL("review.revisions.json", fixtures)));
  assert.deepEqual(first.irBytes, goldenIr); assert.deepEqual(first.revisions, goldenRevisions);
  assert.deepEqual(first.irBytes, second.irBytes); assert.deepEqual(first.revisions, second.revisions);
  assert.equal(first.ir.schema, "burnlist-loop-ir@1");
  assert.equal(first.ir.compiler, "burnlist-loop-compiler@1");
  assert.equal(first.ir.nodes.length, 14);
  assert.equal(first.ir.edges.length, 16);
  assert.deepEqual([...first.ir.nodes.map((node) => node.id)].sort(), ["completed", "converged", "decompose", "exhausted", "failed", "final-review", "final-validate", "implement", "integrate", "needs-human", "review", "start", "stopped", "validate"].sort());
  assert.deepEqual([...first.ir.edges.map((edge) => edge.from)].sort(), ["start", "decompose", "implement", "validate", "validate", "review", "review", "review", "integrate", "final-validate", "final-validate", "final-review", "final-review", "final-review", "converged", "converged"].sort());
  assert.match(first.revisions.executable, /^er1-sha256:[a-f0-9]{64}$/);
  assert.equal((await compileLoopPackage(new URL("./__fixtures__/compiler-review", import.meta.url).pathname)).ok, true);
});

test("runtime consumes persisted frozen IR and validates recipe identity", async () => {
  const result = await compiled(), bytes = freezeRecipe(result), frozen = loadFrozenRecipe(bytes);
  assert.equal(frozen.irBytes, result.irBytes.toString("base64")); assert.deepEqual(frozen.revisions, result.revisions);
  const changed = Buffer.from(bytes).toString().replace("implement", "implement-x");
  assert.throws(() => loadFrozenRecipe(Buffer.from(changed)), /Frozen recipe/);
});

test("pre-H6 frozen recipes and Run journals replay without rewriting their identity", async () => {
  const current = await compiled(), frozen = JSON.parse(freezeRecipe(current));
  const legacyIr = {
    ...current.ir,
    nodes: current.ir.nodes.map(({ execution: _execution, intelligence: _intelligence, ...node }) => node),
  };
  assert.equal(validateClosedIr(legacyIr), false);
  assert.equal(validateReplayIr(legacyIr), true);
  const instructions = frozen.instructions;
  const executable = prefixed("er1-sha256:", "recipe-v1", [
    Buffer.from(legacyIr.compiler), canonicalIrBytes(legacyIr),
    ...instructions.flatMap((section) => [Buffer.from(section.id), Buffer.from(section.bytes, "base64")]),
  ]);
  const legacy = { ...frozen, revisions: { ...frozen.revisions, executable }, ir: legacyIr };
  const bytes = Buffer.from(`${JSON.stringify(legacy)}\n`);
  const loaded = loadFrozenRecipe(bytes);
  assert.equal(loaded.irBytes, canonicalIrBytes(legacyIr).toString("base64"));
  assert.equal(loaded.revisions.executable, executable);
  const journal = [createJournalRecord({ sequence: 1, prevDigest: null, at: 0, type: "run-created", payload: created(legacyIr) })];
  assert.equal(foldRun(journal).graph, legacyIr);
});

test("closed grammar rejects Stage 2 syntax and convergence bypass", async () => {
  const files = await reviewFiles();
  for (const replacement of [
    '<input id="scope"/>', '<gate id="converged" kind="predicate" requires="feedback,review"/>',
    '<edge from="final-review" on="approve" to="completed"/>', '<map from="feedback"/>', '<combine id="x"/>',
  ]) {
    const copied = { ...files, "review.loop": Buffer.from(files["review.loop"].toString().replace('<edge from="final-review" on="approve" to="converged"/>', replacement)) };
    const result = compileLoopFiles(copied); assert.equal(result.ok, false, replacement);
    assert.ok(result.diagnostics.length > 0);
  }
});

test("reviewer requirements close on the supervised Stage 1 boundary", async () => {
  const files = await reviewFiles(), source = files["review.loop"].toString();
  for (const requirements of [
    "fresh-session:enforced,filesystem-write-deny:enforced",
    "fresh-session:enforced,filesystem-write-deny:unsupported",
    "fresh-session:enforced,filesystem-write-deny:supervised,container:docker",
  ]) {
    const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source.replace("fresh-session:enforced,filesystem-write-deny:supervised", requirements)) });
    assert.equal(result.ok, false, requirements);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["E_REVIEW_REQUIREMENTS"]);
  }
});

test("singleton declarations and frozen agent invariants fail closed", async () => {
  const files = await reviewFiles(), source = files["review.loop"].toString();
  for (const element of [
    source.match(/  <budget [^\n]+\/>/u)?.[0],
    source.match(/  <failure-policy [^\n]+\/>/u)?.[0],
  ]) {
    assert.ok(element);
    const duplicated = compileLoopFiles({
      ...files,
      "review.loop": Buffer.from(source.replace(element, `${element}\n${element}`)),
    });
    assert.equal(duplicated.ok, false);
    assert.ok(duplicated.diagnostics.some((item) => item.code === "E_CHILD_COUNT"));
  }
  const result = await compiled();
  const wrongTask = structuredClone(result.ir);
  Object.assign(wrongTask.nodes.find((node) => node.id === "decompose"), { role: "reviewer", authority: "read" });
  assert.equal(validateClosedIr(wrongTask), false);
  const wrongReviewer = structuredClone(result.ir);
  wrongReviewer.nodes.find((node) => node.id === "review").independentFrom = "final-review";
  assert.equal(validateClosedIr(wrongReviewer), false);
});

test("each semantic outcome has one closed, type-safe target", async () => {
  const files = await reviewFiles();
  const source = files["review.loop"].toString().replace('from="validate" on="pass" to="review"', 'from="validate" on="pass" to="implement"');
  const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source) });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === "E_EDGE_TARGET"));
});

test("diagnostics are stable, retained, sorted, and capped", async () => {
  const files = await reviewFiles();
  const malformed = files["review.loop"].toString().replace('max-rounds="12"', 'max-rounds="0" evil="1"').replace('<edge from="start" on="complete" to="decompose"/>', '<edge from="start" on="error" to="completed"/>');
  const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(malformed) });
  assert.equal(result.ok, false);
  const lines = renderDiagnostics(result.diagnostics).trim().split("\n");
  assert.ok(lines.some((line) => line.includes("E_ATTRIBUTE_UNKNOWN")));
  assert.ok(lines.some((line) => line.includes("E_SCALAR")));
  assert.ok(lines.every((line) => /^review\.loop:\d+: E_/.test(line)));
});

test("package lexical limits fail closed before grammar compilation", async () => {
  const files = await reviewFiles();
  const bom = compileLoopFiles({ ...files, "review.loop": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), files["review.loop"]]) });
  assert.equal(bom.ok, false); assert.ok(bom.diagnostics.some((item) => item.code === "E_FILE_BOM"));
  const unknown = compileLoopFiles({ ...files, "later.loop": Buffer.from("x\n") });
  assert.equal(unknown.ok, false); assert.ok(unknown.diagnostics.some((item) => item.code === "E_PACKAGE_PATH"));
});

test("instruction extraction is exact and treats fenced headings as prose", async () => {
  const files = await reviewFiles();
  const markdown = "## start\nscope\n```md\n## review\n```\n## review\nreview text\n## decompose\ndecompose\n## implement\nimplement\n## integrate\nintegrate\n## final-review\ninspect\n";
  const good = compileLoopFiles({ ...files, "instructions.md": Buffer.from(markdown) });
  assert.equal(good.ok, true, renderDiagnostics(good.diagnostics ?? []));
  const bad = compileLoopFiles({ ...files, "instructions.md": Buffer.from("## start\nscope\n## start\nagain\n") });
  assert.equal(bad.ok, false); assert.ok(bad.diagnostics.some((item) => item.code === "E_INSTRUCTIONS_DUPLICATE"));
  const tilde = "## start\nscope\n~~~\n## review\nfenced text\n~~~\n## review\nreview text\n## decompose\nsplit\n## implement\nimplement\n## integrate\nintegrate\n## final-review\ninspect\n";
  assert.equal(compileLoopFiles({ ...files, "instructions.md": Buffer.from(tilde) }).ok, true);
});

test("equivalent source formatting preserves IR and executable identity", async () => {
  const files = await reviewFiles(), changed = files["review.loop"].toString().replace("\n  <budget", "\n\n  <budget");
  const first = compileLoopFiles(files), second = compileLoopFiles({ ...files, "review.loop": Buffer.from(changed) });
  assert.equal(second.ok, true, renderDiagnostics(second.diagnostics ?? []));
  assert.deepEqual(second.irBytes, first.irBytes); assert.equal(second.revisions.executable, first.revisions.executable);
  assert.notEqual(second.revisions.source, first.revisions.source);
});

test("frozen artifacts reject unknown fields, bad identities, tampering, and mutable bytes", async () => {
  const result = await compiled(), bytes = freezeRecipe(result), mutate = (fn) => { const value = JSON.parse(bytes); fn(value); return Buffer.from(`${JSON.stringify(value)}\n`); };
  for (const change of [
    (value) => { value.extra = true; }, (value) => { value.ir.extra = true; },
    (value) => { value.ir.nodes[0].extra = true; }, (value) => { value.instructions[0].bytes += "\n"; },
    (value) => { value.revisions.source = value.revisions.source.replace("ls1", "er1"); },
    (value) => { value.revisions.package = value.revisions.package.replace("lp1", "ls1"); },
    (value) => { value.revisions.executable = value.revisions.executable.replace("er1", "lp1"); },
  ]) assert.throws(() => loadFrozenRecipe(mutate(change)), TypeError);
  const frozen = loadFrozenRecipe(bytes);
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.ir) && Object.isFrozen(frozen.ir.nodes[0]) && Object.isFrozen(frozen.instructions[0]));
  assert.equal(Buffer.isBuffer(frozen.instructions[0].base64), false);
  assert.throws(() => { frozen.ir.nodes[0].id = "changed"; }, TypeError);
});

test("frozen replay rejects every closed-IR union, cap, reference, and ordering violation", async () => {
  const bytes = freezeRecipe(await compiled()), mutate = (change) => { const value = JSON.parse(bytes); change(value.ir); return Buffer.from(`${JSON.stringify(value)}\n`); };
  for (const change of [
    (ir) => { ir.nodes[0].mode = "stage-two"; }, (ir) => { ir.nodes.find((node) => node.id === "review").requires[1] = "filesystem-write-deny:enforced"; }, (ir) => { ir.edges[0].on = "unknown"; },
    (ir) => { ir.declaredVersion = "01.0.0"; }, (ir) => { ir.budget.maxRounds = 0; },
    (ir) => { ir.nodes.reverse(); }, (ir) => { ir.edges.reverse(); }, (ir) => { ir.instructions.reverse(); },
    (ir) => { ir.nodes[0].instructions = "absent"; }, (ir) => { ir.edges[0].to = "missing"; },
    (ir) => { ir.edges[0].maxVisits = 1; }, (ir) => { ir.failurePolicy.error = "stopped"; },
  ]) assert.throws(() => loadFrozenRecipe(mutate(change)), TypeError);
});

test("closed grammar rejects named later constructs", async () => {
  const files = await reviewFiles(), source = files["review.loop"].toString();
  for (const name of ["input", "condition", "source", "operator", "target", "map", "foreach", "join", "combine", "branch"]) {
    const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source.replace('<edge from="final-review" on="approve" to="converged"/>', `<${name} id="later"/>`)) });
    assert.equal(result.ok, false, name); assert.ok(result.diagnostics.some((item) => item.code === "E_ELEMENT_UNKNOWN"));
  }
  const altered = Buffer.from(source.replace('<agent id="implement" mode="task" execution="host" intelligence="standard" role="maker" route="implementation.standard" authority="write" instructions="implement"/>', '<agent id="implement" role="maker" route="implementation.standard" authority="write" instructions="implement"/>'));
  const result = compileLoopFiles({ ...files, "review.loop": altered });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some((item) => item.code === "E_ATTRIBUTE_REQUIRED"));
});

test("every Stage 1 element required attribute and scalar union is closed", async () => {
  const files = await reviewFiles(), source = files["review.loop"].toString();
  const required = [
    'id="start"', 'version="0.1.0"', 'entry="start"', 'max-rounds="12"', 'max-minutes="60"', 'max-agent-runs="18"', 'max-check-runs="8"', 'max-transitions="40"', 'max-output-bytes="262144"',
    'id="implement"', 'mode="task"', 'execution="host"', 'intelligence="standard"', 'role="maker"', 'route="implementation.standard"', 'authority="write"', 'instructions="implement"', 'id="decompose"', 'id="integrate"', 'id="review"', 'mode="review"', 'role="reviewer"', 'route="review.strong"', 'authority="read"', 'independent-from="implement"', 'requires="fresh-session:enforced,filesystem-write-deny:supervised"', 'id="final-review"', 'independent-from="implement"', 'id="validate"', 'id="final-validate"', 'capability="repo-verify"', 'id="converged"', 'kind="convergence"', 'state="converged"', 'error="failed"', 'timeout="failed"', 'cancelled="stopped"', 'lost="needs-human"', 'exhausted="exhausted"', 'from="start"', 'on="complete"', 'to="decompose"',
  ];
  for (const token of required) {
    const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source.replace(token, "")) });
    assert.equal(result.ok, false, token); assert.ok(result.diagnostics.some((item) => item.code === "E_ATTRIBUTE_REQUIRED"), token);
  }
  for (const [token, replacement] of [['mode="task"', 'mode="stage-two"'], ['execution="host"', 'execution="remote"'], ['intelligence="standard"', 'intelligence="provider-name"'], ['role="maker"', 'role="planner"'], ['authority="write"', 'authority="admin"'], ['route="implementation.standard"', 'route="invalid..route"'], ['kind="convergence"', 'kind="metric"'], ['state="converged"', 'state="done"'], ['max-visits="3"', 'max-visits="0"']]) {
    const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source.replace(token, replacement)) });
    assert.equal(result.ok, false, replacement);
  }
});

test("diagnostic truncation and recovery keep the first 99 sorted findings", async () => {
  const files = await reviewFiles(), extras = Array.from({ length: 110 }, (_, index) => ` bad-${index}="x"`).join("");
  const source = files["review.loop"].toString().replace('version="0.1.0"', 'version="0"').replace('max-rounds="12"', `max-rounds="0"${extras}`).replace('<edge from="start" on="complete" to="decompose"/>', '<edge from="start" on="error" to="completed"/>');
  const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source) });
  assert.equal(result.ok, false); assert.equal(result.diagnostics.length, 100);
  assert.equal(result.diagnostics[0].code, "E_TOO_MANY_DIAGNOSTICS");
  assert.ok(result.diagnostics.some((item) => item.code === "E_SCALAR"));
  assert.ok(result.diagnostics.slice(1).every((item, index, all) => index === 0 || item.byteOffset >= all[index - 1].byteOffset));
});

test("grammar diagnoses malformed attribute and complete semantic/system routing", async () => {
  const files = await reviewFiles(), source = files["review.loop"].toString();
  const duplicate = source.replace('id="review" version', 'id="review" id="again" version');
  let result = compileLoopFiles({ ...files, "review.loop": Buffer.from(duplicate) });
  assert.equal(result.ok, false); assert.deepEqual(result.diagnostics[0], { path: "review.loop", byteOffset: 18, code: "E_XML_DUPLICATE_ATTRIBUTE", message: "Duplicate attribute id" });
  const missing = source.replace('<edge from="final-review" on="approve" to="converged"/>\n', "");
  result = compileLoopFiles({ ...files, "review.loop": Buffer.from(missing) });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some((item) => item.code === "E_EDGE_MISSING"));
  const system = source.replace('lost="needs-human"', 'lost="failed"');
  result = compileLoopFiles({ ...files, "review.loop": Buffer.from(system) });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some((item) => item.code === "E_FAILURE_POLICY"));
  const duplicateSystem = source.replace('error="failed"', 'error="failed" error="failed"');
  result = compileLoopFiles({ ...files, "review.loop": Buffer.from(duplicateSystem) });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some((item) => item.code === "E_XML_DUPLICATE_ATTRIBUTE"));
  const bypass = source.replace('from="final-review" on="approve" to="converged"', 'from="final-review" on="approve" to="completed"');
  result = compileLoopFiles({ ...files, "review.loop": Buffer.from(bypass) });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some((item) => item.code === "E_EDGE_TARGET" || item.code === "E_CONVERGENCE_DOMINATION"));
});

test("recoverable XML findings merge with semantic findings before global sorting", async () => {
  const files = await reviewFiles();
  const source = files["review.loop"].toString().replace('version="0.1.0"', 'version="0" version="still-bad"').replace('max-rounds="12"', 'max-rounds="0" unknown="x"');
  const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["E_SCALAR", "E_XML_DUPLICATE_ATTRIBUTE", "E_ATTRIBUTE_UNKNOWN", "E_SCALAR"]);
  assert.ok(result.diagnostics.every((item, index, all) => index === 0 || item.byteOffset >= all[index - 1].byteOffset));
});

test("literal fenced-section grammar handles both delimiters and false closers", async () => {
  const files = await reviewFiles();
  for (const marker of ["`", "~"]) for (const indent of [0, 1, 2, 3]) {
    const fence = `${" ".repeat(indent)}${marker.repeat(3)} suffix ${marker}\n## review\n${" ".repeat(indent)}${marker.repeat(4)}    \n`;
    const markdown = `## start\nscope\n${fence}## review\nreview text\n## decompose\nsplit\n## implement\nwork\n## integrate\ncombine\n## final-review\ninspect\n`;
    const result = compileLoopFiles({ ...files, "instructions.md": Buffer.from(markdown) });
    assert.equal(result.ok, true, `${marker}/${indent}`);
  }
  const falseCloser = "## start\nscope\n``` suffix `\n## review\n``` not-close\n## review\nreview\n## decompose\nsplit\n## implement\nwork\n## integrate\ncombine\n## final-review\ninspect\n";
  const result = compileLoopFiles({ ...files, "instructions.md": Buffer.from(falseCloser) });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some((item) => item.code === "E_INSTRUCTIONS_FENCE"));
});

test("frozen recipe replay rejects any noncanonical JSON encoding", async () => {
  const result = await compiled();
  const frozen = freezeRecipe(result);
  const value = JSON.parse(frozen);

  const reordered = Buffer.from(JSON.stringify({
    compiler: value.compiler,
    schema: value.schema,
    revisions: value.revisions,
    source: value.source,
    package: value.package,
    ir: value.ir,
    instructions: value.instructions,
  }) + "\n", "utf8");
  assert.throws(() => loadFrozenRecipe(reordered), /Frozen recipe is not canonical/);

  const spaced = Buffer.from(`${frozen.toString("utf8").trim()} \n`, "utf8");
  assert.throws(() => loadFrozenRecipe(spaced), /Frozen recipe is not canonical/);

  const scientific = Buffer.from(frozen.toString("utf8").replace("\"maxRounds\":12", "\"maxRounds\":1.2e1"), "utf8");
  assert.throws(() => loadFrozenRecipe(scientific), /Frozen recipe is not canonical/);
});

test("compiler and frozen replay are exact under round-trip table cases", async () => {
  const files = await reviewFiles();
  const table = [
    { name: "canonical", loop: files["review.loop"].toString() },
    { name: "spacing", loop: files["review.loop"].toString().replace("<budget", "\n  <budget") },
  ];
  for (const row of table) {
    const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(row.loop) });
    assert.equal(result.ok, true, `${row.name} compile must pass`);
    const frozen = freezeRecipe(result);
    const loaded = loadFrozenRecipe(frozen);
    assert.equal(loaded.irBytes, result.irBytes.toString("base64"));
    assert.deepEqual(loaded.ir, result.ir);
    assert.deepEqual(loaded.revisions, result.revisions);
  }
});

test("compiler invariant mirror rejects duplicated reviewer instruction IDs", async () => {
  const files = await reviewFiles();
  const duplicated = compileLoopFiles({ ...files, "review.loop": Buffer.from(files["review.loop"].toString().replace('instructions="review"', 'instructions="implement"')) });
  assert.equal(duplicated.ok, false);
  assert.ok(duplicated.diagnostics.some((item) => item.code === "E_IR_INVARIANT"));
});

test("compiler invariant mirror rejects non-task maker entry", async () => {
  const files = await reviewFiles();
  const source = files["review.loop"].toString().replace('entry="start"', 'entry="validate"');
  const reassigned = compileLoopFiles({ ...files, "review.loop": Buffer.from(source) });
  assert.equal(reassigned.ok, false);
  assert.ok(reassigned.diagnostics.some((item) => ["E_REACHABILITY", "E_ENTRY_KIND", "E_IR_INVARIANT"].includes(item.code)));
});

test("diagnostic truncation keeps the first 99 sorted findings", async () => {
  const files = await reviewFiles(), extras = Array.from({ length: 110 }, (_, index) => ` bad-${index}="x"`).join("");
  const source = files["review.loop"].toString().replace('version="0.1.0"', 'version="0"').replace('max-rounds="12"', `max-rounds="0"${extras}`).replace('<edge from="start" on="complete" to="decompose"/>', '<edge from="start" on="error" to="completed"/>');
  const result = compileLoopFiles({ ...files, "review.loop": Buffer.from(source) });
  assert.equal(result.ok, false); assert.equal(result.diagnostics.length, 100);
  assert.deepEqual(result.diagnostics[0], { path: "", byteOffset: 0, code: "E_TOO_MANY_DIAGNOSTICS", message: "Too many diagnostics (maximum 100)" });
  assert.ok(result.diagnostics.slice(1).every((item, index, all) => index === 0 || item.byteOffset >= all[index - 1].byteOffset));
});
