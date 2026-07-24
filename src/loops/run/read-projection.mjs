import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJournal } from "./run-journal.mjs";
import { foldRun } from "./run-fold.mjs";
import { isRunRef } from "./run-ref.mjs";
import { locateItemSpan, validateAssignedItem } from "../assignment/item-metadata.mjs";
import { assignmentStore } from "../assignment/store.mjs";
import { currentRunAuthority } from "./current-authority.mjs";
import { runStore } from "./run-store.mjs";

const MAX_RUNS = 128;
const fail = (message) => { throw Object.assign(new Error(`Run projection: ${message}`), { code: "ERUN_PROJECTION" }); };

function publicNode(node, routes = []) {
  const common = { id: node.id, kind: node.kind };
  if (node.kind === "agent") {
    const resolved = routes.find((entry) => entry.route === node.route);
    return {
      ...common,
      role: node.role,
      authority: node.authority,
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

export function presentRun(replay) {
  const records = replay.journal;
  let latestResult = null;
  const transitions = [];
  for (const record of records) {
    const { sequence, type, payload } = record.value;
    if (type === "invocation-result") latestResult = {
      kind: payload.kind, summary: payload.summary,
    };
    if (type === "edge-taken") transitions.push({ sequence, from: payload.from, outcome: payload.on, to: payload.to });
    if (type === "state-changed") transitions.push({ sequence, from: payload.from, outcome: payload.cause, to: payload.to });
  }
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
  const runs = join(resolve(repoRoot), ".local", "burnlist", "loop", "m2", "runs");
  if (!existsSync(runs)) return null;
  const base = join(resolve(repoRoot), ".local", "burnlist", "loop", "m2");
  const current = currentRunAuthority({ root: repoRoot, base, random: () => Buffer.alloc(8) }).read()
    .find((entry) => entry.itemRef === itemRef) ?? null;
  if (current && artifact && current.assignmentId !== artifact.assignmentId) return null;
  let entries;
  try { entries = readdirSync(runs, { withFileTypes: true }); } catch { fail("Run projection is corrupt", "ECORRUPT"); }
  const staging = entries.filter((entry) => /^\.create-[a-f0-9]{16}\.tmp$/u.test(entry.name));
  const visible = entries.filter((entry) => !/^\.create-[a-f0-9]{16}\.tmp$/u.test(entry.name));
  if (staging.length > MAX_RUNS || visible.length > MAX_RUNS
    || entries.some((entry) => !entry.isDirectory() || !/^(?:[a-f0-9]+|\.create-[a-f0-9]{16}\.tmp)$/u.test(entry.name))) fail("run directory exceeds bounds");
  let selected = null;
  for (const entry of visible) {
    if (!entry.isDirectory() || !/^[a-f0-9]+$/u.test(entry.name)) fail("Run projection is corrupt", "ECORRUPT");
    let runId;
    try { runId = Buffer.from(entry.name, "hex").toString("utf8"); } catch { fail("Run projection is corrupt", "ECORRUPT"); }
    if (!isRunRef(runId) || Buffer.from(runId).toString("hex") !== entry.name) fail("Run projection is corrupt", "ECORRUPT");
    let journal, folded;
    try {
      journal = readJournal(join(runs, entry.name, "journal"));
      folded = foldRun(journal);
    } catch { fail("Run projection is corrupt", "ECORRUPT"); }
    if (folded.projection.itemRef !== itemRef || current && runId !== current.runId) continue;
    if (artifact && JSON.stringify(folded.graph) !== JSON.stringify(artifact.frozen.ir)) continue;
    if (selected) fail("Run projection is ambiguous", "EAMBIGUOUS");
    selected = { ...folded, journal };
  }
  if (current && !selected) fail("current Run is unavailable", "ECURRENT");
  if (!selected) return null;
  const stored = runStore(repoRoot).read(selected.projection.runId);
  selected.loopIdentity = stored.loopIdentity;
  selected.agentRoutes = stored.agentRoutes;
  return presentRun(selected);
}
