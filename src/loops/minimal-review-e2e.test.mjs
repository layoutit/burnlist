import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createProductionRunAuthority, fixtureItemRef } from "./run/run-test-fixtures.mjs";
import { readLatestRunForItem } from "./run/read-projection.mjs";
import { runStore } from "./run/run-store.mjs";
import { createStoredProductionRunRunner } from "./run/binder.mjs";
import { readOvenEvents } from "../events/oven-event-store.mjs";
import { cliJson, cliOk, request, startCli, waitForExit, waitForFile, withDashboard } from "./minimal-review-e2e-fixtures.mjs";
import { checklistFixture } from "../../dashboard/src/components/ChecklistDashboard/ChecklistDashboard.fixture.mjs";
import { withDeterministicTime } from "../../dashboard/src/oven/test-support/deterministic-time.mjs";

const componentPath = new URL("../../dashboard/src/components/ChecklistDashboard/ChecklistDashboard.tsx", import.meta.url).pathname;
const normalizerPath = new URL("../../dashboard/src/oven/test-support/dom-normalize.ts", import.meta.url).pathname;
const libPath = new URL("../../dashboard/src/lib", import.meta.url).pathname;
const ovenPath = new URL("../../dashboard/src/oven", import.meta.url).pathname;
const domGoldenPath = new URL("./__fixtures__/minimal-review-e2e-dom.golden.json", import.meta.url);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function addUnassignedItem(path, item) {
  writeFileSync(path, readFileSync(path, "utf8").replace("\n## Completed", `\n- [ ] ${item}\n\n## Completed`));
}
function edges(projection) {
  return projection.transitions.filter((item) => !["prepared", "running", "paused"].includes(item.from)).map(({ from, outcome, to }) => ({ from, outcome, to }));
}
function liveProjection(baseUrl, planPath, headers = {}) {
  return request(baseUrl, `/api/loop-projection?plan=${encodeURIComponent(planPath)}`, { headers });
}
function hostResult(execution, outcome) {
  return { schema: "burnlist-loop-host-report@1", result: {
    schema: "agent-result@1", runId: execution.runId, nodeId: execution.nodeId, attempt: execution.attempt,
    claimId: execution.claimId, assignmentId: execution.assignmentId, invocationId: execution.invocationId,
    recipeRevision: execution.recipeRevision, policyRevision: execution.policyRevision,
    inputCandidate: execution.inputCandidate, outcome, findings: [], resolvedFindingIds: [],
  }, telemetry: null };
}
function hostFixture(repo) {
  const directory = join(repo, ".burnlist", "loops", "host-review");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "host-review.loop"), `<loop id="host-review" version="0.1.0" entry="implement">
<budget max-rounds="8" max-minutes="60" max-agent-runs="12" max-check-runs="8" max-transitions="32" max-output-bytes="262144"/>
<agent id="implement" mode="task" execution="host" intelligence="standard" role="maker" route="implementation.standard" authority="write" instructions="implement"/><check id="validate" capability="repo-verify"/>
<agent id="review" mode="review" execution="host" intelligence="strong" role="reviewer" route="review.strong" authority="read" independent-from="implement" requires="fresh-session:enforced,filesystem-write-deny:supervised" instructions="review"/><agent id="refine" mode="task" execution="host" intelligence="standard" role="maker" route="implementation.standard" authority="write" instructions="refine"/><agent id="integrate" mode="task" execution="host" intelligence="strong" role="maker" route="implementation.standard" authority="write" instructions="integrate"/><check id="final-validate" capability="repo-verify"/>
<agent id="final-review" mode="review" execution="host" intelligence="critical" role="reviewer" route="review.strong" authority="read" independent-from="integrate" requires="fresh-session:enforced,filesystem-write-deny:supervised" instructions="final-review"/><gate id="converged" kind="convergence" requires="final-validate,final-review"/>
<terminal id="completed" state="converged"/><terminal id="needs-human" state="needs-human"/><terminal id="failed" state="failed"/><terminal id="stopped" state="stopped"/><terminal id="exhausted" state="budget-exhausted"/><failure-policy error="failed" timeout="failed" cancelled="stopped" lost="needs-human" exhausted="exhausted"/>
<edge from="implement" on="complete" to="validate"/><edge from="validate" on="pass" to="review"/><edge from="validate" on="fail" to="refine"/><edge from="review" on="approve" to="integrate"/><edge from="review" on="reject" to="refine"/><edge from="review" on="escalate" to="needs-human"/><edge from="refine" on="complete" to="validate" max-visits="3"/><edge from="integrate" on="complete" to="final-validate"/><edge from="final-validate" on="pass" to="final-review"/><edge from="final-validate" on="fail" to="refine"/><edge from="final-review" on="approve" to="converged"/><edge from="final-review" on="reject" to="refine"/><edge from="final-review" on="escalate" to="needs-human"/><edge from="converged" on="pass" to="completed"/><edge from="converged" on="fail" to="needs-human"/>
</loop>\n`);
  writeFileSync(join(directory, "instructions.md"), ["implement", "review", "refine", "integrate", "final-review"].map((id) => `## ${id}\nHost fixture instruction.\n`).join("\n"));
  cliOk(repo, ["loop", "unassign", fixtureItemRef]);
  cliOk(repo, ["loop", "assign", fixtureItemRef, "loop:project:host-review"]);
}
async function managedCheck(repo, runId, expected) {
  const runner = createStoredProductionRunRunner({ repoRoot: repo, store: runStore(repo), runId });
  await runner.step(); await runner.step(); await runner.step();
  assert.equal(runner.replay().execution.nodeId, expected);
  runner.pause();
}
async function dashboardRenderer(t) {
  const output = await mkdtemp(join(process.cwd(), ".m9-checklist-render-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const componentOutput = join(output, "ChecklistDashboard.mjs"), normalizerOutput = join(output, "dom-normalize.mjs");
  await Promise.all([
    build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: componentOutput, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
    build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
  ]);
  const [{ ChecklistDashboard }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
    import(`${new URL(`file://${componentOutput}`).href}?m9=${Date.now()}`),
    import(`${new URL(`file://${normalizerOutput}`).href}?m9=${Date.now()}`),
  ]);
  return (checkpoint, loopRun) => {
    const candidateAliases = new Map(), alias = (id) => {
      if (!id) return id;
      if (!candidateAliases.has(id)) candidateAliases.set(id, `candidate-${candidateAliases.size + 1}`);
      return candidateAliases.get(id);
    };
    const base = Date.parse("2026-07-15T11:00:00Z");
    const stableActivity = loopRun?.activity && {
      ...loopRun.activity,
      records: loopRun.activity.records.map((record, index) => ({
        ...record,
        at: base + index * 100,
        ...(record.correlation ? { correlation: "<invocation-correlation>" } : {}),
      })),
    };
    const stableTelemetry = loopRun?.execution?.telemetry && {
      ...loopRun.execution.telemetry,
      startedAt: loopRun.execution.telemetry.startedAt === null ? null : base,
      completedAt: loopRun.execution.telemetry.completedAt === null ? null : base + 500,
    };
    const stableRun = loopRun && { ...loopRun, createdAt: base, updatedAt: base + 4_000,
      budget: { ...loopRun.budget, elapsedMilliseconds: 4_000 },
      execution: loopRun.execution && { ...loopRun.execution, telemetry: stableTelemetry },
      activity: stableActivity,
      latestMaker: loopRun.latestMaker && { ...loopRun.latestMaker, at: base + 1_000, candidateId: alias(loopRun.latestMaker.candidateId) },
      latestCheck: loopRun.latestCheck && { ...loopRun.latestCheck, at: base + 2_000, candidateId: alias(loopRun.latestCheck.candidateId) },
      latestReviewer: loopRun.latestReviewer && { ...loopRun.latestReviewer, at: base + 3_000, candidateId: alias(loopRun.latestReviewer.candidateId) } };
    const active = stableRun ? [{
      id: stableRun.itemRef.split("#").at(-1),
      title: "Loop-assigned item",
      fields: {},
      loop: { selector: `loop:builtin:${stableRun.loopId}` },
    }] : [];
    const dom = serializeCanonical(normalize(parseHtml(withDeterministicTime(() =>
      renderToStaticMarkup(createElement(ChecklistDashboard, { data: { ...checklistFixture, active, loopRun: stableRun } })) ))));
    return { record: { checkpoint, domBytes: Buffer.byteLength(dom), domSha256: digest(dom) }, dom };
  };
}

test("M9 no-network CLI slice exposes interruption, repair, invalidation refetch, UI states, escalation, and completion", { timeout: 60_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-m9-e2e-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const planPath = join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md");
  addUnassignedItem(planPath, "DIRECT-01 | Unassigned direct-flow control");
  const render = await dashboardRenderer(t);

  await withDashboard(repo, async (baseUrl) => {
    const absent = await liveProjection(baseUrl, planPath);
    assert.equal(absent.status, 200); assert.equal(JSON.parse(absent.body).loopRun, null);
    const view = cliOk(repo, ["loop", "view", fixtureItemRef]);
    assert.match(view, /^MODE: ITEM-PINNED$/mu); assert.match(view, /decompose.*implement.*validate.*review/su);

    const escalation = cliJson(repo, ["loop", "create", fixtureItemRef]).runId, escalationCounter = join(directory, "escalation-counter");
    writeFileSync(escalationCounter, "0");
    const escalated = cliJson(repo, ["loop", "run", escalation], {
      BURNLIST_FAKE_COUNTER: escalationCounter, BURNLIST_FAKE_OUTCOMES: "complete,complete,complete,escalate",
    });
    assert.equal(escalated.state, "needs-human");
    const escalationInspection = cliJson(repo, ["loop", "inspect", escalation]);
    assert.deepEqual(edges(escalationInspection).slice(-1), [{ from: "review", outcome: "escalate", to: "needs-human" }]);
    const escalationHttp = await liveProjection(baseUrl, planPath);
    assert.equal(escalationHttp.status, 200); const escalationProjection = JSON.parse(escalationHttp.body).loopRun;
    assert.deepEqual(escalationProjection, escalationInspection);
    const needsHumanUi = render("needs-human", escalationProjection);
    assert.match(needsHumanUi.dom, /<section aria-label="Item L29 detail" class="checklist-workspace__column checklist-workspace__detail">/u);
    assert.match(needsHumanUi.dom, /<pre aria-label="Loop for L29" class="loop-compact" role="img">/u);
    assert.match(needsHumanUi.dom, /aria-current="step"/u);
    assert.equal(existsSync(join(repo, ".local", "burnlist", "loop", "m2", "runs", Buffer.from(escalation).toString("hex"), "completion-receipt.json")), false);
    assert.match(readFileSync(planPath, "utf8"), /- \[ \] L29/u);

    const interruptedRun = cliJson(repo, ["loop", "create", fixtureItemRef]).runId;
    const counter = join(directory, "counter"), started = join(directory, "started.json");
    writeFileSync(counter, "0");
    const first = startCli(repo, ["loop", "run", interruptedRun], {
      BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,reject,complete,approve",
      BURNLIST_FAKE_STARTED: started, BURNLIST_FAKE_WAIT_MS: "1000",
    });
    await waitForFile(started, first);
    const active = JSON.parse(readFileSync(started, "utf8"));
    assert.equal(existsSync(`${started}.${active.pid}.tmp`), false, "ready marker is atomically published");
    assert.equal(active.node, "start"); assert.equal(first.kill("SIGINT"), true);
    const interrupted = await waitForExit(first);
    assert.equal(interrupted.code, 0, interrupted.stderr);
    const interruptedProjection = JSON.parse(interrupted.stdout);
    // The fake Codex executable cannot prove descendant cleanup.  That is a
    // lost external owner, not a resumable pause.
    assert.equal(interruptedProjection.state, "needs-human");
    assert.throws(() => process.kill(active.pid, 0), { code: "ESRCH" });
    const interruptedInspection = cliJson(repo, ["loop", "inspect", interruptedRun]);
    const interruptedStatus = cliJson(repo, ["loop", "status", interruptedRun]);
    for (const projection of [interruptedInspection, interruptedStatus]) {
      assert.equal(projection.loopId, "review");
      assert.match(projection.loopRevision, /^er1-sha256:[a-f0-9]{64}$/u);
      assert.equal(Number.isSafeInteger(projection.createdAt), true);
      assert.equal(Number.isSafeInteger(projection.updatedAt), true);
      assert.ok(projection.updatedAt >= projection.createdAt);
    }
    assert.equal(interruptedStatus.state, "needs-human");
    assert.equal(interruptedInspection.latestResult, null);
    const interruptedRaw = runStore(repo).read(interruptedRun);
    assert.ok(interruptedRaw.execution.externalClaim, "lost ownership remains visible for human recovery");
    assert.equal(interruptedRaw.projection.leaseHeld, false);
    assert.equal(interruptedRaw.journal.some((record) => record.value.type === "external-claim-bound"), true);
    assert.equal(interruptedRaw.journal.some((record) => record.value.type === "external-claim-resolved"), false);

    // A closed lost Run may be replaced by a fresh Run.  The normal E2E then
    // exercises reject/repair/convergence without pretending fake cleanup is
    // resumable.
    const runId = cliJson(repo, ["loop", "create", fixtureItemRef]).runId;
    writeFileSync(counter, "0");
    const completed = cliJson(repo, ["loop", "run", runId], { BURNLIST_FAKE_COUNTER: counter,
      BURNLIST_FAKE_OUTCOMES: "complete,complete,complete,reject,complete,complete,approve,complete,approve" });
    assert.equal(completed.state, "converged"); assert.equal(completed.currentNode, "completed");
    assert.deepEqual(edges(completed), [
      { from: "start", outcome: "complete", to: "decompose" },
      { from: "decompose", outcome: "complete", to: "implement" },
      { from: "implement", outcome: "complete", to: "validate" },
      { from: "validate", outcome: "pass", to: "review" },
      { from: "review", outcome: "reject", to: "decompose" },
      { from: "decompose", outcome: "complete", to: "implement" },
      { from: "implement", outcome: "complete", to: "validate" },
      { from: "validate", outcome: "pass", to: "review" },
      { from: "review", outcome: "approve", to: "integrate" },
      { from: "integrate", outcome: "complete", to: "final-validate" },
      { from: "final-validate", outcome: "pass", to: "final-review" },
      { from: "final-review", outcome: "approve", to: "converged" },
      { from: "converged", outcome: "pass", to: "completed" },
    ]);
    const completedRaw = runStore(repo).read(runId);
    const agentClaims = completedRaw.journal.filter((record) => record.value.type === "external-claim-bound");
    const checkInvocations = completedRaw.journal.filter((record) => record.value.type === "invocation-started");
    const reviewerClaims = agentClaims.filter((record) => ["review", "final-review"].includes(record.value.payload.claim.nodeId));
    assert.equal(agentClaims.length, 9); assert.equal(reviewerClaims.length, 3);
    assert.deepEqual(agentClaims.filter((record) => record.value.payload.claim.nodeId === "implement")
      .map((record) => record.value.payload.claim.attempt), [1, 2]);
    const candidates = completedRaw.journal.filter((record) => record.value.type === "candidate-bound").map((record) => record.value.payload.candidateId);
    assert.equal(candidates.length, 6);
    assert.equal(new Set(candidates).size, 2, "repair publishes a fresh repository candidate");
    const resultCandidate = (startedRecord) => completedRaw.journal.find((record) =>
      record.value.type === "invocation-result" && record.value.payload.invocationId === startedRecord.value.payload.invocationId)?.value.payload.candidateId;
    assert.deepEqual(checkInvocations.map(resultCandidate), [candidates[2], candidates[4], candidates[5]],
      "each trusted check is bound to the latest candidate");
    const reportCandidate = (claimRecord) => completedRaw.journal.find((record) =>
      record.value.type === "external-report-accepted"
      && record.value.payload.claimId === claimRecord.value.payload.claim.claimId)?.value.payload.candidateId;
    assert.deepEqual(reviewerClaims.map(reportCandidate), [candidates[2], candidates[4], candidates[5]],
      "each reviewer report is bound to its checked candidate");
    const invocationIds = agentClaims.map((record) => record.value.payload.invocationId);
    assert.equal(new Set(invocationIds).size, invocationIds.length, "every agent invocation id is globally unique");
    assert.equal(readFileSync(counter, "utf8"), "9");
    const beforeRestart = cliJson(repo, ["loop", "inspect", runId]);
    assert.deepEqual(cliJson(repo, ["loop", "run", runId]), completed, "terminal restart is an idempotent read");
    assert.deepEqual(cliJson(repo, ["loop", "inspect", runId]), beforeRestart, "terminal restart writes no journal records");
    const convergedHttp = await liveProjection(baseUrl, planPath);
    assert.equal(convergedHttp.status, 200); const convergedProjection = JSON.parse(convergedHttp.body).loopRun;
    assert.deepEqual(convergedProjection, completed);
    const replay = readLatestRunForItem({ repoRoot: repo, itemRef: fixtureItemRef });
    assert.deepEqual(replay, completed, "invalidation consumers refetch the canonical current Run");
    const invalidations = readOvenEvents(repo, { ovenIds: ["checklist"] }).filter((event) => event.kind === "loop-projection-changed" && event.cursor === completed.revision);
    assert.equal(invalidations.length, 1); assert.deepEqual(invalidations[0].payload, { revision: completed.revision });

    const domGolden = JSON.parse(await readFile(domGoldenPath, "utf8"));
    assert.deepEqual(needsHumanUi.record, domGolden[0]);
    assert.deepEqual(render("converged", convergedProjection).record, domGolden[3]);

    const firstCompletion = cliJson(repo, ["loop", "complete", runId]);
    const secondCompletion = cliJson(repo, ["loop", "complete", runId]);
    assert.equal(firstCompletion.alreadyApplied, false); assert.equal(secondCompletion.alreadyApplied, true);
    assert.deepEqual(cliJson(repo, ["loop", "inspect", runId]), beforeRestart, "completion owns no journal mutation");
    const plan = readFileSync(planPath, "utf8");
    assert.equal((plan.match(/^- L29 \| /gmu) ?? []).length, 1); assert.equal(existsSync(join(repo, ".local", "burnlist", "loop", "m2", "runs", Buffer.from(runId).toString("hex"), "completion-intent.json")), false);
    assert.equal(existsSync(join(repo, ".local", "burnlist", "loop", "m2", "runs", Buffer.from(runId).toString("hex"), "completion-receipt.json")), true);
    assert.equal(readOvenEvents(repo, { ovenIds: ["checklist"] }).filter((event) => event.kind === "item-burned" && event.subjectId === "260722-001" && event.payload.itemId === "L29").length, 1);
    const post = await liveProjection(baseUrl, planPath);
    assert.equal(post.status, 200); assert.equal(JSON.parse(post.body).loopRun, null);
    assert.deepEqual(render("post-completion", null).record, domGolden.at(-1));

    cliOk(repo, ["burn", "260722-001", "DIRECT-01"]);
    assert.match(readFileSync(planPath, "utf8"), /^- DIRECT-01 \| .* \| Unassigned direct-flow control$/mu);
  });
});

test("H9 host claims survive restart, reject drift, repair, converge, and complete", { timeout: 60_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-h9-host-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const planPath = join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md");
  hostFixture(repo);
  const runId = cliJson(repo, ["loop", "create", fixtureItemRef]).runId;
  const reportPath = join(directory, "host-report.json"), observed = [];
  const report = (claim, outcome) => {
    writeFileSync(reportPath, `${JSON.stringify(hostResult(claim, outcome))}\n`);
    return cliJson(repo, ["loop", "report", claim.claimId, "--result", reportPath]);
  };
  {
    const observe = async (node) => {
      const projection = readLatestRunForItem({ repoRoot: repo, itemRef: fixtureItemRef });
      assert.ok(projection);
      assert.equal(projection.currentNode, node);
      assert.equal(projection.graph.nodes.find((item) => item.id === node)?.executionMode ?? "managed", ["implement", "review", "refine", "integrate", "final-review"].includes(node) ? "host" : "managed");
      observed.push(node);
    };
    await observe("implement");
    const implement = cliJson(repo, ["loop", "claim", runId]).execution;
    assert.equal(implement.nodeId, "implement");
    assert.equal(cliJson(repo, ["loop", "status", runId]).currentNode, "implement", "separate CLI restart preserves the durable claim");
    report(implement, "complete");
    await observe("validate");
    await managedCheck(repo, runId, "review");
    await observe("review");

    const firstReview = cliJson(repo, ["loop", "claim", runId]).execution;
    const drift = join(repo, "src", "host-report-drift.txt");
    writeFileSync(drift, "workspace drift\n");
    writeFileSync(reportPath, `${JSON.stringify(hostResult(firstReview, "reject"))}\n`);
    assert.throws(() => cliJson(repo, ["loop", "report", firstReview.claimId, "--result", reportPath]), /candidate drifted/u);
    assert.equal(cliJson(repo, ["loop", "status", runId]).currentNode, "review");
    rmSync(drift);
    report(firstReview, "reject");
    await observe("refine");
    assert.throws(() => cliJson(repo, ["loop", "complete", runId]), /not converged/u);

    writeFileSync(join(repo, "src", "host-repair.txt"), "repaired candidate\n");
    const refine = cliJson(repo, ["loop", "claim", runId]).execution;
    assert.notEqual(refine.inputCandidate, implement.inputCandidate, "repair must claim a freshly derived candidate");
    report(refine, "complete");
    await observe("validate");
    await managedCheck(repo, runId, "review");
    const review = cliJson(repo, ["loop", "claim", runId]).execution;
    assert.equal(review.inputCandidate, refine.inputCandidate, "review is bound to the repaired candidate");
    report(review, "approve");
    await observe("integrate");
    const integrate = cliJson(repo, ["loop", "claim", runId]).execution;
    report(integrate, "complete");
    await observe("final-validate");
    await managedCheck(repo, runId, "final-review");
    const finalReview = cliJson(repo, ["loop", "claim", runId]).execution;
    report(finalReview, "approve");
    await observe("converged");
    const runner = createStoredProductionRunRunner({ repoRoot: repo, store: runStore(repo), runId });
    await runner.step(); await runner.step(); await runner.step(); await runner.step();
    assert.equal(cliJson(repo, ["loop", "status", runId]).state, "converged");
    assert.deepEqual(observed, ["implement", "validate", "review", "refine", "validate", "integrate", "final-validate", "converged"]);
    assert.equal(cliJson(repo, ["loop", "complete", runId]).alreadyApplied, false);
    assert.doesNotMatch(readFileSync(planPath, "utf8"), /- \[ \] L29/u);
  }
});
