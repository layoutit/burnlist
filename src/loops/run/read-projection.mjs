import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readInitialJournal } from "./run-journal.mjs";
import { locateItemSpan, validateAssignedItem } from "../assignment/item-metadata.mjs";
import { assignmentStore } from "../assignment/store.mjs";
import { currentRunAuthority } from "./current-authority.mjs";
import { runStore } from "./run-store.mjs";
import { projectRunActivity } from "../events/activity-projection.mjs";
import { readLoopObservationRecords } from "../events/hook-observation.mjs";
import { forecastLoopRun } from "../forecast/forecast.mjs";
import { visitRunDirectories } from "./run-codec.mjs";

const RECEIPT_KEYS = ["schema", "runId", "itemRef", "assignmentId", "completedAt", "title", "planDigest"];
const fail = (message) => { throw Object.assign(new Error(`Run projection: ${message}`), { code: "ERUN_PROJECTION" }); };

function publicNode(node, routes = []) {
  const common = { id: node.id, kind: node.kind };
  if (node.kind === "agent") {
    const resolved = routes.find((entry) => entry.route === node.route);
    return {
      ...common,
      role: node.role,
      authority: node.authority,
      executionMode: node.execution,
      intelligence: node.intelligence,
      execution: resolved ? {
        profileId: resolved.profileId,
        model: resolved.model,
        effort: resolved.effort,
        authority: resolved.authority,
      } : null,
    };
  }
  if (node.kind === "check") return { ...common, capability: node.capability };
  if (node.kind === "gate") return { ...common, gateKind: node.gateKind };
  if (node.kind === "terminal") return { ...common, terminalState: node.state };
  return common;
}

export function presentGraph(graph, routes = []) {
  return Object.freeze({
    entry: graph.entry,
    nodes: graph.nodes.map((node) => publicNode(node, routes)),
    edges: graph.edges.map(({ from, on, to }) => ({ from, on, to })),
  });
}

export function presentRun(replay, { optionalRecords = [], forecast = null } = {}) {
  const records = replay.journal;
  let latestResult = null;
  const transitions = [];
  for (const record of records) {
    const { sequence, type, payload } = record.value;
    if (type === "invocation-result" || type === "external-report-accepted") latestResult = {
      kind: payload.kind, summary: payload.summary,
    };
    if (type === "edge-taken") transitions.push({ sequence, from: payload.from, outcome: payload.on, to: payload.to });
    if (type === "state-changed") transitions.push({ sequence, from: payload.from, outcome: payload.cause, to: payload.to });
  }
  const declaredMode = replay.execution.node?.execution;
  const executionMode = replay.execution.started
    ? declaredMode === "managed" ? "managed" : declaredMode === "host" ? "host-reported" : "unavailable"
    : "unavailable";
  const hostTask = replay.execution.node?.kind !== "agent" ? "not-applicable"
    : replay.execution.externalClaim ? "claimed"
      : replay.execution.started ? "resolved" : "awaiting-claim";
  return Object.freeze({
    schema: "burnlist-loop-read-projection@1",
    runId: replay.projection.runId,
    itemRef: replay.projection.itemRef,
    loopId: replay.loopIdentity?.loopId ?? replay.graph.id,
    loopRevision: replay.loopIdentity?.loopRevision ?? null,
    createdAt: records[0].value.at,
    updatedAt: records.at(-1).value.at,
    state: replay.projection.state,
    currentNode: replay.projection.currentNode,
    attempt: replay.projection.attempt,
    cycle: replay.execution.cycle,
    hostTask,
    execution: {
      mode: executionMode,
      started: replay.execution.started,
      usage: replay.execution.telemetry
        && (replay.execution.telemetry.inputTokens !== null || replay.execution.telemetry.outputTokens !== null)
        ? "reported" : "unavailable",
      telemetry: replay.execution.telemetry,
    },
    activity: projectRunActivity({
      runId: replay.projection.runId, graph: replay.graph, journal: records, optionalRecords,
    }),
    forecast,
    latestResult,
    latestMaker: replay.projection.latestMaker,
    latestCheck: replay.projection.latestCheck,
    latestReviewer: replay.projection.latestReviewer,
    revision: replay.revision,
    budget: {
      limits: replay.graph.budget,
      counters: replay.execution.budget.counters,
      elapsedMilliseconds: replay.execution.budget.elapsedMilliseconds,
      journal: replay.execution.budget.journal,
    },
    graph: presentGraph(replay.graph, replay.agentRoutes),
    transitions,
  });
}

/** Read-only bounded discovery. Missing state returns null and never creates directories. */
export function readLatestRunForItem({ repoRoot, itemRef, markdown = null, itemId = null, assignmentId = null }) {
  const root = resolve(repoRoot);
  let artifact = null;
  if (markdown !== null || itemId !== null || assignmentId !== null) {
    try {
      const metadata = validateAssignedItem(itemRef, locateItemSpan(markdown, itemId));
      if (metadata["Assignment-Id"] !== assignmentId) return null;
      artifact = assignmentStore(repoRoot).load(assignmentId);
      if (artifact.itemRef !== itemRef
        || artifact.assignmentId !== assignmentId
        || artifact.assignedItemDigest !== metadata.assignedDigest
        || artifact.unassignedItemDigest !== metadata.unassignedDigest
        || artifact.executionRevision !== metadata["Execution-Revision"]
        || artifact.packageRevision !== metadata["Package-Revision"]) return null;
    } catch {
      return null;
    }
  }
  const runs = join(root, ".local", "burnlist", "loop", "m2", "runs");
  if (!existsSync(runs)) return null;
  const base = join(root, ".local", "burnlist", "loop", "m2");
  const current = currentRunAuthority({ root: repoRoot, base, random: () => Buffer.alloc(8) }).read()
    .find((entry) => entry.itemRef === itemRef) ?? null;
  if (current && artifact && current.assignmentId !== artifact.assignmentId) return null;
  const store = runStore(repoRoot);
  const load = (runId) => {
    try { return store.read(runId); } catch { fail("Run projection is corrupt", "ECORRUPT"); }
  };
  const initialItem = (runId) => {
    try { return readInitialJournal(store.paths.journalFor(runId)).value.payload.itemRef; }
    catch { fail("Run projection is corrupt", "ECORRUPT"); }
  };
  let selected = null;
  if (current) {
    if (initialItem(current.runId) !== itemRef) fail("current Run is unavailable", "ECURRENT");
    selected = load(current.runId);
    if (selected.projection.itemRef !== itemRef
      || artifact && JSON.stringify(selected.graph) !== JSON.stringify(artifact.frozen.ir))
      fail("current Run is unavailable", "ECURRENT");
  } else {
    try { visitRunDirectories(runs, (runId) => {
      if (initialItem(runId) !== itemRef) return;
      const candidate = load(runId);
      if (artifact && JSON.stringify(candidate.graph) !== JSON.stringify(artifact.frozen.ir)) return;
      if (selected) fail("Run projection is ambiguous", "EAMBIGUOUS");
      selected = candidate;
    }); } catch (error) {
      if (error?.code === "ERUN_PROJECTION") throw error;
      if (error?.code === "EBOUNDS") fail("Run projection exceeds bounds", "EBOUNDS");
      fail("Run projection is corrupt", "ECORRUPT");
    }
  }
  if (current && !selected) fail("current Run is unavailable", "ECURRENT");
  if (!selected) return null;
  const optionalRecords = readLoopObservationRecords(root, selected.projection.runId);
  return presentRun(selected, {
    optionalRecords,
    forecast: forecastLoopRun({ repoRoot: root, replay: selected, optionalRecords }),
  });
}

/** Resolve a completed ledger item through its retained CLI completion receipt. */
export function readCompletedRunForItem({ repoRoot, itemRef, completedAt, title }) {
  const root = resolve(repoRoot);
  const base = join(root, ".local", "burnlist", "loop", "m2");
  if (!existsSync(base)) return null;
  const current = currentRunAuthority({ root, base, random: () => Buffer.alloc(8) }).read()
    .find((entry) => entry.itemRef === itemRef) ?? null;
  if (!current) return null;
  const receiptPath = join(base, "runs", Buffer.from(current.runId).toString("hex"), "completion-receipt.json");
  let bytes;
  try {
    const entry = lstatSync(receiptPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 2 || entry.size > 8192) fail("completion receipt is corrupt");
    bytes = readFileSync(receiptPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ERUN_PROJECTION") throw error;
    fail("completion receipt is corrupt");
  }
  let receipt;
  try { receipt = JSON.parse(bytes); } catch { fail("completion receipt is corrupt"); }
  if (!receipt || Object.keys(receipt).length !== RECEIPT_KEYS.length
    || !RECEIPT_KEYS.every((key, index) => Object.keys(receipt)[index] === key)
    || receipt.schema !== "burnlist-loop-completion@1"
    || receipt.runId !== current.runId || receipt.itemRef !== itemRef
    || receipt.assignmentId !== current.assignmentId
    || receipt.completedAt !== completedAt || receipt.title !== title
    || !Buffer.from(`${JSON.stringify(receipt)}\n`).equals(bytes)) fail("completion receipt does not match the completed item");
  return readLatestRunForItem({ repoRoot: root, itemRef });
}
