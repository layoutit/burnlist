# Loop Progress

`loop-progress.oven` is a compact, read-only lens over canonical Burnlist item
and Loop Run data. It answers what is happening, why it matters, which
subsystem and declared files are in scope, and where that work sits in the
whole Burnlist architecture.

## Data Shape

- Input mode: `json-payload`.
- Runtime validator: `validateGenericJsonData`.
- Starter data: none.
- Render contract: `checklist-progress@1`.

## State Contract

- Canonical sources: the selected item contract, active checklist order,
  frozen Loop assignment, and item-scoped Run projection.
- Hook activity is displayed as unavailable until a bounded hook projection is
  part of the canonical payload. It is never inferred from declared files.

The Oven is declarative and read-only. Selecting an item changes its declared
context and assigned Loop preview; it does not change the authoritative Run or
its active node.
