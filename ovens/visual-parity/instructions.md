# Visual Parity

Visual Parity compares trusted reference and candidate frames as isolated render passes. Each domain declares whether it qualifies the current scenario (`target`) or remains visible diagnostic context (`context`), so unrelated render domains never contaminate one another.

## Data Shape

- Input mode: `json-payload`.
- Runtime validator: `validateVisualParityRuntimeData`.
- Starter data: none.

The runtime validator is the authority used by both `oven set` and the render
handler. It requires a `burnlist-visual-parity-data@1` document containing a
valid selected Differential Testing payload, 1-12 uniquely qualified `domains`,
and ordered `comparisons` with complete dimension-aligned screenshot triplets,
reconciled difference metrics, tolerances, and target-only verdicts. There is
no `example/data.json`, so `oven use visual-parity` adopts without data.

The project adapter publishes `burnlist-visual-parity-data@1`. A passing domain must satisfy its explicit calibrated channel, mean-delta, and changed-pixel bounds. Context domains remain visible and retain their own pass/fail state, but do not decide the target scenario verdict.

Do not widen a tolerance to make a regression green. Calibrate only a deterministic renderer-boundary residual with a written rationale, preserve the zero-tolerance default, and keep gameplay/state authority in the linked Differential Testing payload.

The visual-parity detail view renders through the `.oven` engine
(`ovens/visual-parity/visual-parity.oven`), byte-for-byte identical to the React
`VerdictHeader` / `DomainTabs` / `MetricTiles` / `DomainNote` / `FrameCard` /
`ImageTriptych` components, as verified by dom-golden coverage. Domain-tab
selection is wired declaratively by id with a `domain-tabs` control and
`selection-from`; the engine is a read-only observer and never mutates canonical
state.
