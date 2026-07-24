const TERMINAL = new Set(["completed", "failed", "stopped", "budget-exhausted", "needs-human"]);
const NONTERMINAL = new Set(["prepared", "running", "pausing", "paused", "quarantined", "converged-pending-completion", "completion-needs-human"]);
const TRANSITIONS = Object.freeze({
  prepared: new Set(["running", "stopped", "failed", "quarantined"]),
  running: new Set(["pausing", "converged-pending-completion", "failed", "stopped", "budget-exhausted", "needs-human", "quarantined"]),
  pausing: new Set(["paused", "quarantined"]),
  paused: new Set(["running", "stopped", "quarantined"]),
  quarantined: new Set(["failed", "stopped", "paused", "budget-exhausted", "needs-human", "converged-pending-completion"]),
  "converged-pending-completion": new Set(["completed", "completion-needs-human"]),
  "completion-needs-human": new Set(["completed", "needs-human"]),
});
const QUARANTINE_TARGETS = Object.freeze({
  prepared: new Set(["failed", "stopped"]),
  running: new Set(["failed", "stopped", "budget-exhausted", "needs-human", "converged-pending-completion"]),
  pausing: new Set(["paused"]),
  paused: new Set(["paused", "stopped"]),
});

function fail(message) { throw Object.assign(new Error(`Loop lifecycle: ${message}`), { code: "ELOOP_STATE" }); }
function exact(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
const ANOMALY = new Set(["clock-monotonic-regression", "clock-wall-regression"]);

export function isTerminalState(state) { return TERMINAL.has(state); }
export function isNonterminalState(state) { return NONTERMINAL.has(state); }

export function validateTransition({ from, to, settleTo = null }) {
  if (!NONTERMINAL.has(from) || !TRANSITIONS[from]?.has(to)) fail("state transition is not allowed");
  if (to === "quarantined") {
    if (!QUARANTINE_TARGETS[from]?.has(settleTo)) fail("quarantine settle target is not allowed from source state");
  } else if (settleTo !== null) fail("only quarantine carries a settle target");
  return Object.freeze({ from, to, settleTo });
}

export function stateTransitionPayload(value) {
  if (!exact(value, ["schema", "from", "to", "settleTo"]) || value.schema !== "burnlist-loop-run-state-transition@1") fail("invalid state transition payload");
  return Object.freeze({ schema: value.schema, ...validateTransition(value) });
}

export function legacyTransitionPayload(value) {
  if (!exact(value, ["schema", "from", "to"]) || value.schema !== "burnlist-loop-state-transition@1") fail("invalid legacy state transition");
  const transition = validateTransition({ from: value.from, to: value.to, settleTo: null });
  if (transition.to === "quarantined") fail("legacy transition cannot represent quarantine");
  return transition;
}

export function clockAnomalyTransitionPayload(value) {
  if (!exact(value, ["schema", "from", "to", "code", "sequence"])
    || value.schema !== "burnlist-loop-clock-anomaly-transition@1" || !NONTERMINAL.has(value.from)
    || value.to !== "needs-human" || !ANOMALY.has(value.code)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1) fail("invalid clock anomaly transition");
  return Object.freeze({ ...value });
}

/** The sole lifecycle fold used by store, execution, deadlines, and recovery. */
export function foldLifecycle(records) {
  if (!Array.isArray(records) || records[0]?.value?.type !== "run-created") fail("journal lacks Run creation");
  let state = "prepared", settleTo = null;
  const stateAfter = [];
  for (const [index, record] of records.entries()) {
    if (index && ["run-state-transition", "state-transition", "clock-anomaly-transition"].includes(record.value.type)) {
      if (record.value.type === "clock-anomaly-transition") {
        const transition = clockAnomalyTransitionPayload(record.value.payload);
        if (transition.from !== state) fail("clock anomaly transition predecessor does not match replay");
        state = transition.to; settleTo = null; stateAfter.push(state); continue;
      }
      const transition = record.value.type === "run-state-transition"
        ? stateTransitionPayload(record.value.payload) : legacyTransitionPayload(record.value.payload);
      if (transition.from !== state) fail("state transition predecessor does not match replay");
      if (state === "quarantined" && transition.to !== settleTo) fail("quarantine may settle only to its immutable target");
      state = transition.to;
      settleTo = state === "quarantined" ? transition.settleTo : null;
    }
    stateAfter.push(state);
  }
  return Object.freeze({ state, settleTo, stateAfter: Object.freeze(stateAfter) });
}
