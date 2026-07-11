# Differential Testing Data Contract

Projects feed Differential Testing with one JSON document using schema `burnlist-differential-testing-data@1`. The project owns capture, composed exact-first execution, project-specific checks, normalization, and atomic publication. Burnlist validates and renders the result without importing project code.

```sh
burnlist differential-testing validate /absolute/path/to/differential-testing.json
burnlist --oven-data differential-testing=/absolute/path/to/differential-testing.json
```

The structural schema is `skills/burnlist/contracts/differential-testing-data.schema.json`. The packaged validator is authoritative because it also recomputes relationships that JSON Schema cannot express.

## Primary Sample Tuple

Every field contains ordered `samples` tuples:

```json
[42, 10.5, 10.75, 1]
```

The positions are `tick`, `reference`, `candidate`, and `state`:

- `0`: values match under the declared tolerance
- `1`: both values exist and do not match
- `2`: reference is missing
- `3`: candidate is missing
- `4`: both are missing

Tick identity increases strictly and matches every field exactly. Values are JSON scalars or null. Null remains a present value for state `0` or `1`; missing values use only states `2` through `4`.

## Primary Reconciliation

The validator recomputes:

- tick ordering and cross-field tick identity
- sample state from values and tolerance
- failed, missing, first non-pass, and maximum-delta metadata
- field, sample, and run partitions
- progress chronology and reverse log chronology
- blocked trust from missing samples or blocked fields

`failedSampleCount` counts state `1`. `missingSampleCount` counts states `2` through `4`. Every summary `total` equals `passed + failed + blocked`.

A blocked payload names at least one blocker. It may retain valid partial rows or publish no rows when normalization is unsafe. It cannot manufacture passed or failed fields from unavailable data.

## History Identity

Result rows may carry:

```json
{
  "gateId": "gate-17",
  "scenarioId": "scenario-a",
  "reportSha256": "...",
  "runtimeTreeSha256": "...",
  "contractSha256": "..."
}
```

History without all five identities is display only. A current configured-scenario gate requires the current `log` row and latest `progress` row to bind its gate, report, runtime tree, scenario, and contract.

## Adapter Boundary

An adapter must:

1. Use a stable adapter id.
2. Align real sample identities rather than array positions alone.
3. Preserve reference/candidate roles and null/missing distinctions.
4. Declare field owner, meaning, unit, and tolerance.
5. Reopen and hash project artifacts before reporting their identities.
6. Run the project-owned checks required by the composed controller.
7. Normalize one retained exact session rather than selecting newest files independently.
8. Emit blocked state for stale, contradictory, incomplete, or partially written evidence.
9. Publish atomically.

Burnlist validates the reported identities, arithmetic, and session consistency. It does not receive project artifact bytes, so project hash and checker claims are `adapter-attested`, not independently verified by Burnlist.

The neutral example under `skills/burnlist/examples/differential-testing/` demonstrates the base aggregate boundary. Projects may add the optional normalized surfaces described below.

## Aggregate Telemetry

`telemetry` compares the current candidate against one earlier candidate while both use the same trusted reference. It always has `authority: "telemetry-only"`. The primary fields, KPIs, log result, and PASS/FAIL status remain current candidate-versus-reference truth.

Sparse transition tuples are:

```json
[42, 1, 0]
```

The positions are `tick`, `baselineState`, and `candidateState`. Only `1 -> 0` and `0 -> 1` transitions are sparse entries. Every field also reports:

- `failToPassCount`
- `passToFailCount`
- `stayedPassCount`
- `stayedFailCount`
- `netFailedSampleDelta`
- `residualCount`
- `reconciliation: "reconciled"`

The four transition classes partition every comparable sample. The validator requires:

```text
candidate failures - baseline failures
  = pass-to-fail - fail-to-pass
  = net failed-sample delta

residual = 0
```

The aggregate summary must equal the sum of its field summaries. Both candidates use the same declared reference, scenario, alignment, and contract. Each artifact seal includes a checker-attested canonical tick/state-vector digest; this prevents a baseline-state vector and its sparse transitions from being relocated together without invalidating the seal. `buildDifferentialTelemetry()` additionally checks field ids, semantics, tolerances, ticks, and reference values before constructing telemetry.

Adapters use `differentialStateVectorSha256(payload)` from the packaged contract module to compute the canonical digest. The corresponding `stateVectorCheck` attests that digest and names the artifact SHA-256 from which the vector was normalized.

A blocked telemetry names a blocker and carries no transition summary or field claims. It does not block or rewrite the primary comparison. Changed uses only these tolerance-state transitions; it never grants source, experiment, retention, application, or repository authority.

## Automatic Configured-Scenario Gate

`telemetryGate` describes the controller-owned full-scenario telemetry gate. It always has `authority: "telemetry-only"`, and `configuredScenario.cadenceFrames` is fixed at `10`.

The gate records the configured scenario frame count, replay/profile/contract identities, cleared exact-prefix frames, completed and next boundaries, and the checked report when current. The validator derives `nextBoundary` from the highest crossed boundary. The terminal scenario frame count is also a valid final boundary when it is not a multiple of 10.

After an accepted exact result crosses one or more new 10-frame boundaries, the composed controller runs the full-scenario gate once. That single run records the highest crossed boundary and covers every lower boundary crossed by the same candidate. For example, moving from 9 to 31 cleared frames runs one gate and records boundary 30.

The gate refreshes aggregate reports, progress/log history, and dashboard charts. It does not recapture exact evidence, rerun exact extraction, or rebuild the candidate decision. Its result, exit status, aggregate failure totals, transition counts, intervals, absence, blocked state, or lag cannot authorize or veto engine retention. Only the cadence controller may promote the current full-scenario report.

## Retained Exact Session

`exactSession` is optional. When present, it has:

```text
strategy  = exact-first
status    = ready | complete | blocked
authority = adapter-attested
result    = advanced | complete | rejected | evidence-only | blocked
```

It is one compact retained session, not a candidate-cycle history. A ready or complete session directly identifies:

- `id`, `generatedAt`, `scenarioId`, `scenarioFrameCount`, `profileId`, and `runtimeSide`
- `referenceSha256`, `reportSha256`, `stateSha256`, `runtimeTreeSha256`, `replaySha256`, `profileSha256`, and `contractSha256`
- `clearedPrefixFrames` and `nextBoundary`
- the exact contract, including schema, hash, scope, canonical order, numeric authority, and retention scope
- the current exact frontier and prefix identity
- one compact decision with retained/candidate session identity, blockers, next action, and a target only when applicable
- one surfaced source-owned producer for a ready divergence

A blocked session may omit evidence that is unavailable, but it names at least one concrete blocker and exposes no fallback aggregate target. A complete session has a terminal frontier and no producer. The adapter must not assemble the session by mixing independently selected latest artifacts.

The compact decision kind is `runtime-change`, `evidence-change`, `complete`, or `blocked`. A ready session uses `runtime-change` or `evidence-change`; a terminal session uses `complete`; and a blocked session uses `blocked`. The decision records `targetFieldId` and `targetLabel` only when applicable, plus `nextAction`, blockers, `retainedSessionId`, and `candidateSessionId`. The decision kind describes the next authorized kind of work, while `result` describes the composed transaction that produced the retained session.

### Result Semantics

- `advanced`: the candidate has no earlier divergence and a strictly later exact prefix. The candidate session becomes the retained session.
- `complete`: the candidate clears the configured scenario exactly. The candidate session becomes the retained session.
- `rejected`: the candidate has the same or an earlier exact frontier. Its candidate session id remains distinct, and the existing retained session stays active.
- `evidence-only`: source or tool evidence improved without an engine-retention decision or runtime-tree replacement.
- `blocked`: a concrete source, replay, mapping, evidence, or tool gap prevents a trustworthy result.

Only `advanced` and `complete` retain a changed engine runtime tree. Aggregate improvements, smaller same-coordinate errors, dashboard results, and configured-gate exit status cannot satisfy either result.

### Exact Frontier And Producer

A divergence frontier carries frame, optional control index, tick, optional call index, optional phase order, phase, field id/label, source owner, optional operation id, reference/candidate values, optional bit strings, prefix count, and prefix digest.

The exact contract uses one canonical lexicographic order: `frame`, `control`, `tick`, `call`, `phaseOrder`, `phase`, `operationId`, then `fieldId`. Subsets and reordered keys are invalid. An advanced result requires a lexicographically later coordinate and a strictly larger prefix with no earlier divergence. A smaller error at the same coordinate is rejected.

A ready producer names one exact stored field plus its source owner, source anchor, operation, frame, tick, phase, candidate class, and verdict. It also reports lifecycle, same-frame input proof, mechanics/config provenance, dependency coverage, oracle mode, source-order proof, and edit-scope readiness. The producer may be absent from aggregate field rows or have zero tolerance-state failures; the exact target still follows it and never substitutes an aggregate symptom.

A runtime change fails closed unless the producer is an actionable `edit-candidate`, has a concrete source anchor and operation, uses an edit-ready source lifecycle, has proven or inapplicable inputs/provenance/coverage, uses a strict or numeric-toleranced oracle, and describes either one source-coherent operation or a proven atomic source-order bundle. Evidence-only and blocked results preserve incomplete readiness honestly instead of promoting it.

The normalized readiness vocabularies are:

```text
lifecycle: source-phase | mechanics | contact | render-committed | top-level | diagnostic | mixed | unknown
inputProof: proven | not-applicable | drifting | missing | unknown
provenance: source-provided | not-applicable | substitute | generic-default | mixed | missing | unknown
dependencyCoverage: covered | not-applicable | gap | unknown
oracleMode: strict | numeric-toleranced | diagnostic | source-blocked | noisy
sourceOrder: single-operation | atomic-proven | unproven
changeScope: single-source-coherent | atomic-source-order | unproven
```

### One Composed Candidate Transaction

The project controller evaluates a candidate with one transaction:

1. Execute the candidate engine once for combined dashboard-series and raw tick evidence.
2. Extract the candidate exact prefix once.
3. Detect whether the runtime tree changed.
4. Compare the candidate summary directly with the retained summary over their shared replay domain.
5. Return one exact result.
6. Preserve the retained session on rejection, or atomically publish the candidate as the retained session on advancement or completion.
7. Materialize the next exact frontier and producer when another divergence remains.

Different bounded capture lengths are valid over their shared replay domain. An unchanged runtime tree is evidence refresh, not a candidate advancement. A rejected candidate stops before downstream analysis.

Do not require a separate capture and comparison command, a second deterministic capture, an independent comparison rebuild, a candidate patch/diff artifact, a per-candidate sandbox, a frame ladder, or interim repository actions. Burnlist does not execute or reconstruct this transaction. It validates and renders the adapter's compact result.

## End-of-Scenario History

There is no per-candidate exact ledger in the normalized contract. Exact-first publication replaces the compact retained session. Progress and log remain aggregate telemetry history and update at the automatic gate cadence.

Only after `result: "complete"` should a project run its full tool suite once, optionally audit saved artifacts, inspect the cumulative dirty engine diff, perform authorized repository actions, and publish one durable handoff or history update. If work stops earlier, the retained session itself is the handoff: trusted reference, runtime/report state, scenario/replay/profile/contract, exact frontier and prefix, cleared frames, next boundary, telemetry gate state, source owner, current result, blockers, and one next action.

## Renderer Semantics

- Value and Delta use primary candidate-versus-reference samples.
- Changed uses only reconciled telemetry transitions when present.
- The normalized runtime target uses only the retained exact frontier and its surfaced producer when exact-first is active.
- A blocked or complete exact session declares no runtime target.
- Exact authority remains contract data and does not add a non-template dashboard panel.
- The configured full-scenario gate is telemetry only and never changes the exact retention result.
- Polling observes primary results, telemetry seals, configured-gate state, and the complete compact retained session so evidence-only changes refresh without a page reload.
