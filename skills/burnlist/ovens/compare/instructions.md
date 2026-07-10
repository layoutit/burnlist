# Compare

Compare is the default source-versus-candidate comparison Oven. It applies one neutral dashboard and evidence contract to any workflow that compares aligned frames, ticks, samples, fields, or state rows from a reference implementation and a candidate implementation.

The goal is to make the candidate match the trusted reference. The dashboard is a reader over comparable machine artifacts, not a substitute for source evidence or a reason to patch visible symptoms.

## State Contract

Canonical state lives in project-owned reference captures, candidate captures, comparison reports, and an append-only run history. A project adapter maps those artifacts into the normalized Compare payload. The Oven does not collect, transform, or repair project data.

The adapter must preserve source values, candidate values, nulls, sample identity, field semantics, thresholds, and provenance. It must not invent missing points, coerce nulls to zero, reverse source and candidate roles, stretch one series to match another, or classify unavailable data as a pass.

## Run Inputs

A Run needs a repository, title, and objective. The objective must name:

- the reference capture and its authority
- the candidate capture
- the comparison report or project adapter
- the active scenario, profile, map, route, or seed
- the sample alignment key and expected sample count
- the field contract and tolerance policy
- the command or procedure that produces a comparable rerun

## Normalized Payload

The project adapter supplies one payload with these top-level sources:

- `summary.runs`: total, passed, and failed comparable runs
- `summary.fields`: total, passed, and failed compared fields
- `summary.frames`: total, passed, and failed aligned samples
- `progress`: comparable historical results for the active gate
- `log`: append-only run outcomes with result, value, delta, and timestamp
- `fields`: paired reference and candidate series plus field semantics and failure metadata

`fields` is the authoritative input to the comparison surface. Each row identifies the field, semantic owner, unit, alignment key, tolerance, reference series, candidate series, missing points, failed points, maximum delta, and trust status.

## Trust Gate

Do not use a Compare dashboard for runtime changes unless all of these are true:

1. The reference and candidate artifacts are real and named.
2. Their scenario, seed, inputs, timing mode, and sample alignment are comparable.
3. Source and candidate roles are explicit and stable.
4. Every displayed field has a declared semantic owner and unit.
5. Missing and null values remain distinguishable from numeric zero.
6. Summary counts reconcile with the field rows and aligned samples.
7. The adapter reports incomplete, stale, or contradictory evidence as blocked rather than passed.

When the trust gate fails, fix the capture, adapter, or comparator. Hiding or blocking the dashboard is not a source fix.

## Candidate Selection

Start from the earliest trusted divergence, then trace upstream to the first source-owned producer whose same-sample inputs still match. Repeated carrier rows and downstream state should remain visible, but they do not become separate patch targets.

Choose one narrow candidate per cycle. If the report cannot distinguish precision drift, lifecycle drift, input drift, or a capture defect, expand the evidence before changing runtime behavior.

## Cycle

1. Read the current reference, candidate, report, and trust status from disk.
2. Confirm the active scenario and alignment contract.
3. Reconcile summary totals against every displayed row.
4. Identify the earliest trusted divergence and its first actionable producer.
5. Make at most one source-backed change when the evidence permits it.
6. Rerun the same scenario and comparison procedure.
7. Revert exactly that change if the comparable result worsens or trust regresses.
8. Append the run result without replacing prior history.

## Results

Record one comparable result:

- `pass`: all required trusted comparisons satisfy the declared contract
- `improved`: the comparable residual moved toward an exact match
- `unchanged`: the comparable residual did not move
- `worsened`: the comparable residual moved away from an exact match
- `blocked`: the comparison is not trustworthy enough to guide runtime changes

Threshold loosening, excluded failures, fabricated values, remapped roles, and sample truncation never count as improvement.

## Detail Page Data

The Compare detail skeleton keeps one presentation for every adapter:

- three summary KPI regions for runs, fields, and frames
- a left progress chart and right structured run log
- one full-width paired-series comparison surface

Domain labels may change through normalized data, but layout, controls, chart semantics, color roles, and row behavior remain owned by the shared Compare renderer.
