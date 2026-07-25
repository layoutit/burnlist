# Loop Progress

`loop-progress.oven` is a compact, read-only lens over canonical Burnlist item
and Loop Run data plus bounded correlated observations. It answers what is
happening, why it matters, which subsystem and declared files are in scope,
where that work sits in the whole Burnlist architecture, and whether it is
progressing.

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
  tokens. Missing values remain `Unavailable`.
- Forecast sources: bounded built-in priors or matching local observations,
  always labelled with confidence and provenance.

The Oven is declarative and read-only. Selecting an item changes its declared
context and assigned Loop preview; it does not change the authoritative Run or
its active node. Observations and forecasts never satisfy a gate or choose an
outcome.
