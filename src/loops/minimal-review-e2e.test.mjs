import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const stableRun = loopRun && { ...loopRun, createdAt: base, updatedAt: base + 4_000,
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
    assert.match(view, /^MODE: ITEM-PINNED$/mu); assert.match(view, /implement.*verify.*review/su);

    const escalation = cliJson(repo, ["loop", "create", fixtureItemRef]).runId, escalationCounter = join(directory, "escalation-counter");
    writeFileSync(escalationCounter, "0");
    const escalated = cliJson(repo, ["loop", "run", escalation], {
      BURNLIST_FAKE_COUNTER: escalationCounter, BURNLIST_FAKE_OUTCOMES: "complete,escalate",
    });
    assert.equal(escalated.state, "needs-human");
    const escalationInspection = cliJson(repo, ["loop", "inspect", escalation]);
    assert.deepEqual(edges(escalationInspection), [
      { from: "implement", outcome: "complete", to: "verify" }, { from: "verify", outcome: "pass", to: "review" },
      { from: "review", outcome: "escalate", to: "needs-human" },
    ]);
    const escalationHttp = await liveProjection(baseUrl, planPath);
    assert.equal(escalationHttp.status, 200); const escalationProjection = JSON.parse(escalationHttp.body).loopRun;
    assert.deepEqual(escalationProjection, escalationInspection);
    const needsHumanUi = render("needs-human", escalationProjection);
    assert.match(needsHumanUi.dom, /<section aria-label="Loop for item L29" class="panel checklist-current" id="L29">/u);
    assert.match(needsHumanUi.dom, /aria-current="step"/u);
    assert.equal(existsSync(join(repo, ".local", "burnlist", "loop", "m2", "runs", Buffer.from(escalation).toString("hex"), "completion-receipt.json")), false);
    assert.match(readFileSync(planPath, "utf8"), /- \[ \] L29/u);

    const runId = cliJson(repo, ["loop", "create", fixtureItemRef]).runId;
    const counter = join(directory, "counter"), started = join(directory, "started.json");
    writeFileSync(counter, "0");
    const first = startCli(repo, ["loop", "run", runId], {
      BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,reject,complete,approve",
      BURNLIST_FAKE_STARTED: started, BURNLIST_FAKE_WAIT_MS: "1000",
    });
    await waitForFile(started, first);
    const active = JSON.parse(readFileSync(started, "utf8"));
    assert.equal(existsSync(`${started}.${active.pid}.tmp`), false, "ready marker is atomically published");
    assert.equal(active.node, "implement"); assert.equal(first.kill("SIGINT"), true);
    const interrupted = await waitForExit(first);
    assert.equal(interrupted.code, 0, interrupted.stderr);
    const paused = JSON.parse(interrupted.stdout);
    assert.equal(paused.state, "paused"); assert.equal(paused.currentNode, "implement"); assert.equal(paused.attempt, 1);
    assert.throws(() => process.kill(active.pid, 0), { code: "ESRCH" });
    const pausedInspection = cliJson(repo, ["loop", "inspect", runId]);
    const pausedStatus = cliJson(repo, ["loop", "status", runId]);
    for (const projection of [pausedInspection, pausedStatus]) {
      assert.equal(projection.loopId, "review");
      assert.match(projection.loopRevision, /^er1-sha256:[a-f0-9]{64}$/u);
      assert.equal(Number.isSafeInteger(projection.createdAt), true);
      assert.equal(Number.isSafeInteger(projection.updatedAt), true);
      assert.ok(projection.updatedAt >= projection.createdAt);
    }
    assert.equal(pausedStatus.state, "paused"); assert.equal(pausedStatus.currentNode, "implement");
    assert.equal(pausedInspection.latestResult, null);
    assert.equal(pausedInspection.transitions.length, 2, "only prepared→running and running→paused are durable");
    const pausedRaw = runStore(repo).read(runId);
    const pausedPrefix = pausedRaw.journal.map((record) => record.bytes.toString("utf8"));
    const firstImplement = pausedRaw.journal.filter((record) => record.value.type === "invocation-started" && record.value.payload.nodeId === "implement" && record.value.payload.attempt === 1);
    assert.equal(firstImplement.length, 1); assert.equal(pausedRaw.journal.filter((record) => record.value.type === "invocation-result" && record.value.payload.invocationId === firstImplement[0].value.payload.invocationId).length, 0);
    assert.equal(pausedRaw.execution.invocation, null); assert.equal(pausedRaw.projection.leaseHeld, false);
    const pausedHttp = await liveProjection(baseUrl, planPath);
    assert.equal(pausedHttp.status, 200); const pausedProjection = JSON.parse(pausedHttp.body).loopRun;
    assert.deepEqual(pausedProjection, pausedInspection);
    const afterPause = await liveProjection(baseUrl, planPath, { "if-none-match": pausedHttp.headers.etag });
    assert.equal(afterPause.status, 304);

    const repairStarted = join(directory, "repair-started.json");
    const repair = startCli(repo, ["loop", "resume", runId], {
      BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,reject,complete,approve",
      BURNLIST_FAKE_STARTED: repairStarted, BURNLIST_FAKE_WAIT_MS: "1000",
    });
    for (;;) {
      await waitForFile(repairStarted, repair);
      const marker = JSON.parse(readFileSync(repairStarted, "utf8"));
      if (marker.node === "implement" && marker.attempt === 2) { repair.kill("SIGINT"); break; }
      await new Promise((done) => setTimeout(done, 10));
    }
    const repairExit = await waitForExit(repair);
    assert.equal(repairExit.code, 0, repairExit.stderr);
    const repairProjection = JSON.parse(repairExit.stdout);
    assert.equal(repairProjection.state, "paused"); assert.equal(repairProjection.currentNode, "implement");
    assert.equal(repairProjection.attempt, 2); assert.deepEqual(repairProjection.latestResult, { kind: "reject", summary: "fake reject" });
    const repairHttp = await liveProjection(baseUrl, planPath, { "if-none-match": pausedHttp.headers.etag });
    assert.equal(repairHttp.status, 200); assert.deepEqual(JSON.parse(repairHttp.body).loopRun, repairProjection);

    const completed = cliJson(repo, ["loop", "resume", runId], { BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,reject,complete,approve" });
    assert.equal(completed.state, "converged"); assert.equal(completed.currentNode, "completed");
    assert.deepEqual(edges(completed), [
      { from: "implement", outcome: "complete", to: "verify" }, { from: "verify", outcome: "pass", to: "review" },
      { from: "review", outcome: "reject", to: "implement" }, { from: "implement", outcome: "complete", to: "verify" },
      { from: "verify", outcome: "pass", to: "review" }, { from: "review", outcome: "approve", to: "converged" },
      { from: "converged", outcome: "pass", to: "completed" },
    ]);
    const completedRaw = runStore(repo).read(runId);
    assert.deepEqual(completedRaw.journal.slice(0, pausedPrefix.length).map((record) => record.bytes.toString("utf8")), pausedPrefix);
    const implementInvocations = completedRaw.journal.filter((record) => record.value.type === "invocation-started" && record.value.payload.nodeId === "implement");
    const checkInvocations = completedRaw.journal.filter((record) => record.value.type === "invocation-started" && record.value.payload.nodeId === "verify");
    const reviewerInvocations = completedRaw.journal.filter((record) => record.value.type === "invocation-started" && record.value.payload.nodeId === "review");
    assert.equal(implementInvocations.length, 4); assert.equal(reviewerInvocations.length, 2);
    assert.deepEqual(implementInvocations.map((record) => record.value.payload.attempt), [1, 1, 2, 2]);
    const candidates = completedRaw.journal.filter((record) => record.value.type === "candidate-bound").map((record) => record.value.payload.candidateId);
    assert.equal(candidates.length, 2); assert.notEqual(candidates[0], candidates[1], "repair publishes a fresh repository candidate");
    const resultCandidate = (startedRecord) => completedRaw.journal.find((record) =>
      record.value.type === "invocation-result" && record.value.payload.invocationId === startedRecord.value.payload.invocationId)?.value.payload.candidateId;
    assert.deepEqual(checkInvocations.map(resultCandidate), candidates, "each trusted check is bound to its maker candidate");
    assert.deepEqual(reviewerInvocations.map(resultCandidate), candidates, "each reviewer result is bound to its checked candidate");
    const invocationIds = [...implementInvocations, ...reviewerInvocations].map((record) => record.value.payload.invocationId);
    assert.equal(new Set(invocationIds).size, invocationIds.length, "every agent invocation id is globally unique");
    assert.equal(readFileSync(counter, "utf8"), "4");
    const beforeRestart = cliJson(repo, ["loop", "inspect", runId]);
    assert.deepEqual(cliJson(repo, ["loop", "run", runId]), completed, "terminal restart is an idempotent read");
    assert.deepEqual(cliJson(repo, ["loop", "inspect", runId]), beforeRestart, "terminal restart writes no journal records");
    const convergedHttp = await liveProjection(baseUrl, planPath, { "if-none-match": repairHttp.headers.etag });
    assert.equal(convergedHttp.status, 200); const convergedProjection = JSON.parse(convergedHttp.body).loopRun;
    assert.deepEqual(convergedProjection, completed);
    const replay = readLatestRunForItem({ repoRoot: repo, itemRef: fixtureItemRef });
    assert.deepEqual(replay, completed, "invalidation consumers refetch the canonical current Run");
    const invalidations = readOvenEvents(repo, { ovenIds: ["checklist"] }).filter((event) => event.kind === "loop-projection-changed" && event.cursor === completed.revision);
    assert.equal(invalidations.length, 1); assert.deepEqual(invalidations[0].payload, { revision: completed.revision });

    const ui = [render("paused", pausedProjection), render("repair", repairProjection), render("converged", convergedProjection)];
    const domGolden = JSON.parse(await readFile(domGoldenPath, "utf8"));
    assert.deepEqual(needsHumanUi.record, domGolden[0]);
    assert.deepEqual(ui.map((item) => item.record), domGolden.slice(1, 4));

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
