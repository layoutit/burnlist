# Differential Testing

Differential Testing is Burnlist's generic source-versus-candidate Oven. Projects publish `burnlist-differential-testing-data@1`; Burnlist validates and renders it without importing project code or executing project commands.

## Two Selection Modes

Base aggregate mode answers:

```text
Which aligned fields and samples do not satisfy the declared comparison contract?
```

Optional exact-first mode answers:

```text
What is the retained first exact divergence, which source-owned producer owns it, and what should happen next?
```

When an adapter declares exact-first mode, the normalized runtime target follows only the retained exact frontier and its source-owned producer. Missing or contradictory exact evidence produces `blocked`. Aggregate failures, Changed, history, and visually loud intervals cannot replace the exact target.

## Evidence Surfaces

- Primary fields are candidate-versus-reference truth under declared tolerances. Null remains a present value and missing samples remain explicit missing states.
- Aggregate telemetry reports reconciled fail-to-pass, pass-to-fail, stayed-pass, stayed-fail, and zero residual between two candidates. It remains `telemetry-only`.
- One retained exact session reports adapter-attested trusted-reference and runtime/report state, replay/profile/contract identity, the exact prefix and frontier, a source-owned producer, the composed-loop result, blockers, and one next action.
- One scenario catalog and event-driven refresh record identify the selected scenario and whether its latest automatic update is queued, running, complete, or failed.

These surfaces do not collapse into each other. Tolerance-state transitions locate changed evidence. Exact-prefix movement requires no earlier divergence and a strictly later exact prefix. Only `advanced` or `complete` retains a changed engine candidate.

The first durably retained exact scenario automatically requests scenario initialization, even before a full-scenario report exists. If that signal is unavailable, the next composed-loop invocation retries it without agent intervention. Every later exact-prefix advancement requests a full-scenario telemetry refresh. The project-owned service coalesces requests, publishes `queued` and `running` while work is in flight, then atomically publishes `complete` with a checked report or `failed` with an error. Aggregate totals, transitions, exit status, intervals, absence, failure, or lag cannot authorize or veto retention.

## Lean Exact-First Workflow

The project owns one composed candidate transaction:

1. Read the retained first-failure session and trace its exact field to an edit-ready source-owned producer.
2. Apply one source-coherent engine change and run focused cheap checks.
3. Invoke the composed loop once. It runs the engine once, extracts the exact prefix once, compares directly with the retained summary, publishes one result, and automatically requests initial scenario registration or a refresh when the exact prefix advances.
4. Keep the change for `advanced` or `complete`. Reverse only the latest change for `rejected`. Treat `evidence-only` as source/tool evidence progress and `blocked` as a named seam to repair.
5. Continue immediately from the retained next frontier.

There is no manual capture/locate/compare chain, second deterministic capture, frame ladder, independent comparison rebuild, per-candidate exact ledger, or interim repository work. Rejected candidates never replace the retained session. The Oven is a passive renderer of the adapter's normalized result; it does not run or reconstruct the transaction.

Only after `complete` should a project run its full tool suite once, inspect the cumulative engine diff, perform authorized repository actions, and write one durable handoff or history update.

## Authority Boundary

The project adapter owns artifact discovery, file hashing, project checks, freshness, source evidence, composed execution, retained-session replacement, refresh execution, request coalescing, and atomic publication. Burnlist validates normalized arithmetic, required identities, result consistency, scenario selection, and refresh state. It only reads published JSON and never executes project commands. It never receives raw reports, raw state bodies, replays, source files, commands, or engine diffs.

Target selection remains source-owned and exact-first. Carrier, render, lifetime, diagnostic, derived, and uncovered rows must be traced upstream. Unknown inputs, substitute configuration, missing provenance, noisy or diagnostic oracles, and unproven edit scope fail closed to evidence work. A smaller error at the same exact coordinate is not progress.

## Adapter SDK

Burnlist packages a project-neutral adapter SDK for the mechanical lifecycle around that authority boundary. It serializes refresh work, deduplicates request ids, coalesces one causal successor per scenario, discards superseded output, persists restart-safe state, submits signals, validates normalized scenario documents, and atomically switches the read-only Oven bundle.

The SDK requires project callbacks for request validation, causal succession, scenario identity, telemetry execution, and optional publication on state changes. Those callbacks are the only place raw project evidence may be interpreted. See [Differential Testing Adapter SDK](../skills/burnlist/references/differential-testing-adapter-sdk.md).

## Shared Design

Differential Testing has one canonical renderer and stylesheet. The field surface uses the same hybrid row for every project:

```text
20% field and status | 10% metric and transitions | 70% paired trace
```

Rows are 90px collapsed and 220px expanded. There is no alternate Cards/Table mode and no project-specific route, schema, title, path, command, or CSS.

The visible surface uses the canonical template's HTML and CSS directly: the Parity Progress table and history chart, Search Fields, Value/Delta, Changed, Failed, pagination, and hybrid rows. Exact authority remains in the validated payload and does not add a separate panel.

The dashboard polls every two seconds. The scenario selector loads only catalog-listed sibling payloads from the bound read-only bundle. The status beside it shows Loading, Queued, Updating, or Update failed while the project-owned refresh pipeline changes state. Payload revisions include the complete compact retained session, so exact-frontier or evidence-only changes appear without a page refresh.

See [Differential Testing Data Contract](../skills/burnlist/references/differential-testing-data.md) for the complete payload and validation rules.
