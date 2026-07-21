# Differential Testing Data Contract

Projects feed Differential Testing with a read-only bundle of JSON documents using schema `burnlist-differential-testing-data@1`. The project owns capture, composed exact-first execution, project-specific checks, normalization, refresh execution, and atomic publication. Burnlist validates and renders the result without importing project code or executing project commands.

```sh
burnlist differential-testing validate /absolute/path/to/differential-testing.json
burnlist differential-testing validate-bundle /absolute/path/to/bundle/current.json
burnlist --oven-data differential-testing=/absolute/path/to/current.json
```

The structural schema is `ovens/differential-testing/engine/data.schema.json`. The packaged validator is authoritative because it also recomputes relationships that JSON Schema cannot express.

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

Numeric matches include a scale-aware floating-point boundary allowance when the serialized delta is equal to a positive declared tolerance. This prevents decimal JSON round-trips from turning an exact tolerance boundary into a mismatch; zero tolerance remains exact and values materially above tolerance still fail.

A blocked payload names at least one blocker. It may retain valid partial rows or publish no rows when normalization is unsafe. It cannot manufacture passed or failed fields from unavailable data.

## Scenario Bundle

Small integrations may bind one full `burnlist-differential-testing-data@1` document as the current payload and keep other full scenario documents as contained siblings:

```text
bundle/
  current.json
  scenarios/
    0123456789abcdef.json
    fedcba9876543210.json
```

The bound current payload carries the authoritative `scenarioCatalog.scenarios` array. Each sibling payload names itself with `scenarioCatalog.selectedScenarioId` and may carry only its own catalog entry, so adding a scenario never requires rewriting every large payload. Scenario ids are lowercase 16-character hexadecimal strings. Each catalog entry binds its label, full frame count, replay/profile/contract digests, and update timestamp. The server requires the sibling's selected entry to match the current index, then attaches the authoritative catalog to the validated response.

The dashboard loads `?scenario=<id>` only when the id is in the bound catalog, then reads exactly `scenarios/<id>.json`. It rejects malformed ids, missing files, selected-entry drift, and a scenario file that selects a different id. There is no legacy path scan or newest-file fallback.

A clean bundle with no reports uses exactly `scenarioCatalog: { "selectedScenarioId": null, "scenarios": [] }` and `refresh: null`, with zero summary metrics and empty `progress`, `log`, and `fields`. It carries no telemetry or exact session. Burnlist renders `No Differential Testing scenarios` and does not scan the sibling directory.

### Scalable transport

Large comparisons should publish `burnlist-differential-testing-bundle@1`. This keeps the catalog and bindings compact while storing each scenario's field records once:

```text
bundle/
  current.json
  scenarios/
    0123456789abcdef/
      scenario.json
      fields.ndjson
```

`current.json` binds every `burnlist-differential-testing-scenario@1` document by contained path, exact byte size, and SHA-256. An empty manifest carries the complete valid empty data document in `emptyData`; a non-empty manifest sets `emptyData` to null. The generation is published with the same atomic directory or symlink swap as the project evidence it describes.

`scenario.json` contains the normalized data envelope without primary sample arrays or comparable telemetry state arrays. Its `fieldIndex` keeps compact field and telemetry metadata plus an exact byte offset, size, and digest for one corresponding `burnlist-differential-testing-field-record@1` line in `fields.ndjson`. Record ids are lexicographically ordered, ordinals preserve project field order, byte ranges are contiguous and LF-terminated, and primary and telemetry records share the same field id.

Burnlist validates the manifest, scenario envelope, whole records digest, every record binding, sample arithmetic, telemetry transitions, state-vector seals, and frame aggregates sequentially. It does not reconstruct the multi-million-sample payload in memory. The dashboard range-reads only the selected 25, 50, 100, or 200 field records and serves them with global summary and frame-delta metrics. Search, Failed, Changed, sorting, and pagination therefore operate before samples cross the HTTP boundary.

The read-only page query accepts `scenario`, `search`, `filter=all|failing`, `sort=default|changed`, zero-based `page`, and `pageSize=25|50|100|200`. Legacy full `burnlist-differential-testing-data@1` bundles remain supported without translation.

## Refresh State

`refresh` is the project-owned event-driven update record. It contains a stable request id, the selected scenario id, the triggering event kind/revision/time, and request lifecycle timestamps. Its states are:

- `queued`: accepted but not started
- `running`: full-scenario comparison is updating
- `complete`: atomically published with a checked full-scenario report
- `failed`: finished without a report and names the error

Every exact-prefix advancement should automatically request a refresh. For `event.kind: "exact-prefix-advanced"`, the event revision is the canonical non-negative decimal `clearedPrefixFrames` that requested that refresh. It may lag the current retained prefix while the refresh is running or after its report completes, because exact work can advance independently. It must never be ahead of the current retained prefix. The project service may coalesce several pending events into its newest queued revision. Burnlist only reads the published state; it does not signal a runtime, start a comparison, invoke an adapter, or execute commands. Refresh success, failure, or lag is telemetry and never changes exact-prefix retention authority.

An adapter may bind a completed refresh report to the immutable project-owned inputs and tooling that produced it:

```json
{
  "executionClosure": {
    "schema": "project-execution-closure@1",
    "id": "execution-closure-42",
    "sha256": "...",
    "size": 2048
  }
}
```

This optional adapter-attested identity is limited to `schema`, `id`, lowercase SHA-256, and positive byte size. Paths, manifest bytes, commands, and execution stay project-owned. The binding identifies a content-addressed closure; it does not claim that Burnlist stored or executed it.

## History Identity

Result rows may carry:

```json
{
  "refreshId": "refresh-17",
  "scenarioId": "0123456789abcdef",
  "reportSha256": "...",
  "runtimeTreeSha256": "...",
  "contractSha256": "..."
}
```

Every history row must name the selected scenario, so one payload can never mix scenario events. Rows without the other four identities are display only. A completed refresh requires the current `log` row and latest `progress` row to bind its refresh, report, runtime tree, scenario, and contract.

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
9. Publish scenario files and the current index atomically.

Burnlist validates the reported identities, arithmetic, and session consistency. It does not receive project artifact bytes, so project hash and checker claims are `adapter-attested`, not independently verified by Burnlist.

The neutral example under `ovens/differential-testing/example/` demonstrates the base aggregate boundary. Projects may add the optional normalized surfaces described below.

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

Adapters import public validation and construction helpers from `burnlist/differential-testing/contract`:

```js
import {
  assertDifferentialTestingData,
  buildDifferentialTelemetry,
  differentialStateVectorSha256,
} from "burnlist/differential-testing/contract";
```

`differentialStateVectorSha256(payload)` computes the canonical digest. The corresponding `stateVectorCheck` attests that digest and names the artifact SHA-256 from which the vector was normalized.

A blocked telemetry names a blocker and carries no transition summary or field claims. It does not block or rewrite the primary comparison. Changed uses only these tolerance-state transitions; it never grants source, experiment, retention, application, or repository authority.

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
- `clearedPrefixFrames`
- the exact contract, including schema, hash, scope, canonical order, numeric authority, and retention scope
- the current exact frontier and prefix identity
- one compact decision with retained/candidate session identity, blockers, next action, and a target only when applicable
- one surfaced source-owned producer for a ready divergence

A blocked session may omit evidence that is unavailable, but it names at least one concrete blocker and exposes no fallback aggregate target. A complete session has a terminal frontier and no producer. The adapter must not assemble the session by mixing independently selected latest artifacts.

`exactSession.status: complete` is scoped to the published exact contract. It is never a scenario PASS claim; the primary current candidate-versus-reference report remains the sole PASS/FAIL result.

The compact decision kind is `runtime-change`, `evidence-change`, `complete`, or `blocked`. A ready session uses `runtime-change` or `evidence-change`; a terminal session uses `complete`; and a blocked session uses `blocked`. The decision records `targetFieldId` and `targetLabel` only when applicable, plus `nextAction`, blockers, `retainedSessionId`, and `candidateSessionId`. The decision kind describes the next authorized kind of work, while `result` describes the composed transaction that produced the retained session.

### Result Semantics

- `advanced`: the candidate has no earlier divergence and a strictly later exact prefix. The candidate session becomes the retained session.
- `complete`: the candidate clears the configured scenario exactly. The candidate session becomes the retained session.
- `rejected`: the candidate has the same or an earlier exact frontier. Its candidate session id remains distinct, and the existing retained session stays active.
- `evidence-only`: source or tool evidence improved without an engine-retention decision or runtime-tree replacement.
- `blocked`: a concrete source, replay, mapping, evidence, or tool gap prevents a trustworthy result.

Only `advanced` and `complete` retain a changed engine runtime tree. Aggregate improvements, smaller same-coordinate errors, dashboard results, and refresh status cannot satisfy either result.

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

There is no per-candidate exact ledger in the normalized contract. Exact-first publication replaces the compact retained session. Progress and log remain aggregate telemetry history and update whenever the project completes an event-driven refresh.

Only after `result: "complete"` should a project run its full tool suite once, optionally audit saved artifacts, inspect the cumulative dirty engine diff, perform authorized repository actions, and publish one durable handoff or history update. If work stops earlier, the retained session itself is the handoff: trusted reference, runtime/report state, scenario/replay/profile/contract, exact frontier and prefix, cleared frames, refresh state, source owner, current result, blockers, and one next action.

## Renderer Semantics

- Value and Delta use primary candidate-versus-reference samples.
- Changed uses only reconciled telemetry transitions when present.
- The normalized runtime target uses only the retained exact frontier and its surfaced producer when exact-first is active.
- A blocked or complete exact session declares no runtime target.
- Exact authority remains contract data and does not add a non-template dashboard panel.
- Refresh state is telemetry only and never changes the exact retention result.
- Polling observes primary results, telemetry seals, refresh state, scenario selection, and the complete compact retained session so evidence-only changes refresh without a page reload.
- The server validates and caches each atomic payload generation, emits a distinct `ETag` per scenario response, and returns `304 Not Modified` for an unchanged scenario so polling never reparses or retransmits the full payload.
