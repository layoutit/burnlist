import { createHash } from "node:crypto";
import { isRunRef } from "./run-ref.mjs";
import { foldStateMachine, validateGraph } from "./state-machine.mjs";

const exact = (value, keys) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (message) => { throw new Error(`Run fold: ${message}`); };
export function foldRun(records) {
  const first = records?.[0]?.value;
  if (!first || first.type !== "run-created" || !exact(first.payload, ["schema", "runId", "itemRef", "graph", "authorityRequired"]) || first.payload.schema !== "burnlist-loop-m2-run@1" || !isRunRef(first.payload.runId) || typeof first.payload.itemRef !== "string" || typeof first.payload.authorityRequired !== "boolean") fail("invalid creation");
  validateGraph(first.payload.graph);
  const execution = foldStateMachine({ graph: first.payload.graph, records }), last = records.at(-1);
  const projection = Object.freeze({ schema: "burnlist-loop-m2-projection@1", runId: first.payload.runId, itemRef: first.payload.itemRef, state: execution.state, currentNode: execution.nodeId, attempt: execution.attempt, cycle: execution.cycle, generation: execution.generation, leaseHeld: Boolean(execution.lease), counters: execution.budget.counters, journal: execution.budget.journal, latestMaker: execution.latest.maker, latestCheck: execution.latest.check, latestReviewer: execution.latest.reviewer, sequence: last.value.sequence, journalDigest: last.digest });
  const bytes = Buffer.from(`${JSON.stringify(projection)}\n`), revision = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return Object.freeze({ graph: first.payload.graph, execution, projection, bytes, revision });
}
