# Differential Testing

Differential Testing is the generic source-versus-candidate Oven. It renders aligned machine evidence from any project through one normalized contract. It does not import project code, execute project commands, select files, repair captures, apply or revert engine edits, or grant authority.

The objective is an exact match to a trusted reference. Tolerance-state charts summarize the current comparison. They are evidence locators, not a substitute for the retained exact frontier or a source-owned producer.

## Operating Modes

An adapter may publish either mode:

- `aggregate`: normalized paired samples and declared tolerances guide a conventional comparison cycle
- `exact-first`: an optional retained `exactSession` reports the active exact frontier, source-owned producer, composed-loop result, and one next action

When `exactSession.strategy` is `exact-first`, exact target selection fails closed. Missing, stale, failed, contradictory, or unbound exact evidence produces `blocked`. The adapter and validator must not fall back to field failure counts, first failing aggregate ticks, Changed, history, or visually prominent intervals.

## State Contract

Canonical state stays in project-owned captures, reports, retained runtime state, replay/profile data, exact artifacts, checker outputs, and source evidence. A project adapter maps compact facts from those artifacts into `burnlist-differential-testing-data@1`. Burnlist validates and renders only that normalized document.

The adapter must preserve:

- reference and candidate roles
- real sample identity and ordering
- source values, candidate values, and exact stored representations when declared
- null values as values, so null remains distinguishable from numeric zero
- missing samples as missing states
- field semantics, source owner, unit, and tolerance
- scenario, trusted reference, replay, profile, report, state, retained runtime tree, and exact contract identities
- artifact hashes, checker attestations, exact prefix, frontier, and blockers without promotion by inference

The adapter must never invent points, stretch one series to another, select newest files independently, combine artifacts from different runs, weaken thresholds, hide regressions, or classify unavailable evidence as a pass.

## Normalized Payload

The required comparison surface contains:

- `summary.runs`, `summary.fields`, and `summary.frames`
- chronological `progress` and reverse-chronological `log`
- aligned `fields` with paired reference/candidate samples and normalized state

Optional surfaces are independent:

- `telemetry` compares two candidates against one reference. It uses `authority: "telemetry-only"` and contains reconciled fail-to-pass, pass-to-fail, stayed-pass, stayed-fail, and residual counts.
- `telemetryGate` reports the controller-owned full-scenario telemetry gate. Its cadence is fixed at 10 newly cleared frames. It records the highest crossed boundary and may cover multiple boundaries with one run. It uses `authority: "telemetry-only"`; its result, absence, blocked state, or lag cannot authorize or veto retention.
- `exactSession` uses `authority: "adapter-attested"`. It is the one retained exact-first session and contains the compact runtime/report state, replay/profile/contract identity, exact prefix and frontier, source-owned producer, composed-loop result, blockers, next telemetry boundary, and one next action.

Raw reports, raw state bodies, replay bodies, source files, commands, engine diffs, and full project packets stay outside the Oven.

## Adapter Attestation Boundary

Burnlist validates normalized structure, arithmetic, chronology, required identities, and session consistency. It cannot prove that a declared digest matches bytes it never receives.

The project adapter owns file reopening, hashing, project-specific checker execution, freshness checks, exact extraction, candidate comparison, telemetry cadence, retained-session replacement, and atomic publication. `adapter-attested` means those checks were reported by the adapter. It does not mean Burnlist independently verified project artifacts.

An authoritative retained session must attest one comparable scenario, trusted reference, replay, profile, exact contract, retained runtime tree, report/state pair, exact prefix, and frontier. Its surfaced producer and next action must describe that same frontier. A complete session has no divergence or runtime target. A blocked session names the concrete evidence, source, replay, mapping, or tool gap. Any stale or contradictory identity blocks exact authority.

## Trust Gate

The primary comparison is trustworthy only when:

1. Reference and candidate artifacts are real and named.
2. Scenario, seed, inputs, timing, alignment, and expected sample coverage are comparable.
3. Roles, field semantics, units, and tolerances are explicit.
4. Missing values and present nulls are preserved.
5. Summary partitions reconcile with field rows and samples.
6. The adapter reports incomplete, stale, contradictory, or partially written data as blocked.

When this gate fails, fix the capture, adapter, or comparison seam before changing runtime behavior.

Telemetry comparability is separate. Both candidates must use the same reference, scenario, alignment, contract, fields, ticks, and reference values. Their canonical tick/state vectors are checker-attested and artifact-bound. Blocked telemetry does not rewrite the primary comparison.

## Exact Target Selection

In aggregate mode, start from the earliest trusted divergence and trace upstream until the candidate is source-owned and edit-ready. A visible field can be a carrier, render symptom, lifetime symptom, diagnostic row, or coverage gap rather than a patch target.

In exact-first mode:

1. Attack only the retained session's first failing frame, then its first failing tick, phase, operation, and stored field.
2. Follow the shortest source-backed path to the earliest edit-ready producer. Collapse carrier, derived, render, wrong-lifetime, and diagnostic rows upstream instead of patching them directly.
3. Changed and aggregate failure rankings remain tolerance telemetry and cannot replace or outrank the exact frontier.
4. A complete or blocked session exposes no runtime target. A rejected result preserves the prior retained frontier. Evidence-only work may improve source or tool facts without claiming engine progress.
5. Missing exact authority is a proof or tooling gap, never permission to use aggregate ranking.

A runtime target additionally requires a concrete source anchor and operation, edit-ready lifecycle, clean-enough same-frame inputs, source-provided mechanics/config provenance when relevant, dependency coverage, a strict or numeric-toleranced oracle, and one source-coherent edit or source-order-proven atomic bundle. Unknown, missing, substitute, uncovered, noisy, diagnostic, render/lifetime, or unproven state fails closed to evidence work or no edit.

## Lean Composed Transaction

The project owns one composed candidate transaction:

1. Read the retained first-failure session.
2. Apply one source-coherent engine edit for its surfaced producer.
3. Run only focused checks that can reject the edit cheaply.
4. Invoke the composed engine loop once.
5. Read one result: `advanced`, `complete`, `rejected`, `evidence-only`, or `blocked`.
6. Keep the edit only for `advanced` or `complete`. Reverse only the latest rejected edit, preserve unrelated dirty work, and retry the same frontier. Repair a named blocking seam and retry when blocked.
7. Continue immediately from the next retained frontier.

One invocation executes the candidate engine once for combined report and raw tick evidence, extracts the exact prefix once, detects whether the runtime tree changed, compares the candidate summary directly with the retained summary, returns one disposition, and materializes the next retained session only when appropriate. Rejected candidates stop before downstream analysis and never replace the retained session.

Do not split this transaction into manual capture, locate, compare, cadence, or authority commands. Do not add a second deterministic capture, rebuild the same comparison independently, make per-candidate diff artifacts or clones, run a frame ladder, or require interim repository work. The Oven observes the adapter's published result; it does not run the transaction.

## Automatic Telemetry Cadence

The composed controller owns one full configured-scenario telemetry gate. It runs automatically whenever an accepted result crosses a new 10-cleared-frame boundary. One gate run covers all 10-frame boundaries crossed by the same accepted candidate.

The gate does not recapture exact evidence, rebuild the candidate decision, or rerun exact extraction. Gate failures, exit status, aggregate totals, intervals, and charts remain telemetry only. They never accept or reject an engine edit. Bounded candidate evidence must not promote the dashboard's current full-scenario report; only the cadence controller may do that.

## Result Semantics

Exact-first results are:

- `advanced`: no earlier divergence and a strictly later exact prefix; retain the candidate and publish the next session
- `complete`: the configured scenario is exact; retain the candidate and enter end-of-scenario work
- `rejected`: the candidate has the same or an earlier exact frontier; discard only that candidate and keep the prior retained session
- `evidence-only`: source or tool evidence improved without an engine-retention decision
- `blocked`: a concrete source, replay, mapping, evidence, or tool gap prevents a trustworthy decision

Aggregate run results remain separate:

- `pass`: all required trusted comparisons satisfy the declared contract
- `improved`: the comparable residual moved toward an exact match
- `unchanged`: the comparable residual did not move
- `worsened`: the comparable residual moved away from an exact match
- `blocked`: evidence is not trustworthy enough to guide the next action

Threshold loosening, excluded failures, fabricated values, role reversal, and sample truncation never count as improvement. Globally worse telemetry remains `worsened`; local fail-to-pass rows remain locators and never authorize retention.

## End-of-Scenario Work

Only after `complete` for the configured scenario should the project run its full tool suite once, optionally audit saved artifacts, inspect the cumulative dirty engine diff, perform authorized repository actions, and write one durable handoff or history update.

If work stops before completion, retain a compact session containing the trusted reference, runtime tree, report/state identity, scenario/replay/profile/contract, exact frontier and prefix, cleared frames, next 10-frame boundary, telemetry gate state, source owner, current result, blockers, and one next action. No per-candidate ledger, diff hash, or command transcript is required.

## History And Refresh

Progress and log rows are gate-bound only when they carry gate, scenario, report, runtime-tree, and contract identities. Otherwise the dashboard labels them display only. The cadence controller owns durable aggregate history publication. Exact-session revisions replace the compact retained session rather than appending candidate-cycle rows, so polling observes source/tool evidence and exact-frontier changes even when no new aggregate report exists.

## Presentation

The shared renderer owns one project-neutral layout:

- summary KPIs
- comparison history and structured run log
- one hybrid field surface with field/status, metric/transition summary, and paired trace
- the copied canonical template: Search Fields, Value/Delta, Changed, Failed, paging, and expand behavior
- no separate exact-authority panel, alternate Cards/Table mode, or project-specific visual control

There is no project-specific route, schema, title, path, command, or stylesheet in this recipe.
