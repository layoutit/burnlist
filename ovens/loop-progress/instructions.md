# Loop Progress

`loop-progress.oven` is a compact, read-only lens over canonical Burnlist item
and Loop Run data plus bounded correlated observations. Its primary question
is: **what is happening to this item right now?**

Pending items show only identity, canonical status, the compact assigned Loop,
and a plain explanation that no agent is working yet. Active, waiting, and
blocked items progressively reveal populated current-step, blocker, proof,
agent, and activity facts. Timing, tokens, paths, Run identity, and provenance
stay in one collapsed details region.

## Data Shape

- Input mode: `json-payload`.
- Runtime validator: `validateGenericJsonData`.
- Starter data: none.
- Render contract: `checklist-progress@1`.

## State Contract

- Canonical sources: selected item contract, queue/ledger state, frozen Loop
  assignment, Run/node/branch/claim, transitions, checks, gates, reviews,
  budgets, blockers, and retries.
- Observational sources: bounded invocation-correlated hooks may expose active
  agent/model/effort, tool activity, contained code paths, timing, and reported
  tokens. Missing facts are omitted rather than rendered as empty telemetry.
- Forecast sources: bounded built-in priors or matching local observations,
  always labelled with confidence and provenance.

The Oven is declarative and read-only. Selecting an item shows only that
item's matching canonical Run; another item's Run cannot make the selection
look active. Observations and forecasts never satisfy a gate or choose an
outcome.
