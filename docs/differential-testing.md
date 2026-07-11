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
- One retained exact session reports adapter-attested trusted-reference and runtime/report state, replay/profile/contract identity, the exact prefix and frontier, a source-owned producer, the composed-loop result, blockers, next telemetry boundary, and one next action.

These surfaces do not collapse into each other. Tolerance-state transitions locate changed evidence. Exact-prefix movement requires no earlier divergence and a strictly later exact prefix. Only `advanced` or `complete` retains a changed engine candidate.

The configured full-scenario gate is automatic telemetry at a fixed 10-cleared-frame cadence. One gate run covers multiple 10-frame boundaries crossed by the same accepted candidate. Its aggregate totals, transitions, exit status, intervals, absence, blocked state, or lag cannot authorize or veto retention.

## Lean Exact-First Workflow

The project owns one composed candidate transaction:

1. Read the retained first-failure session and trace its exact field to an edit-ready source-owned producer.
2. Apply one source-coherent engine change and run focused cheap checks.
3. Invoke the composed loop once. It runs the engine once, extracts the exact prefix once, compares directly with the retained summary, applies automatic telemetry cadence, and publishes one result.
4. Keep the change for `advanced` or `complete`. Reverse only the latest change for `rejected`. Treat `evidence-only` as source/tool evidence progress and `blocked` as a named seam to repair.
5. Continue immediately from the retained next frontier.

There is no manual capture/locate/compare chain, second deterministic capture, frame ladder, independent comparison rebuild, per-candidate exact ledger, or interim repository work. Rejected candidates never replace the retained session. The Oven is a passive renderer of the adapter's normalized result; it does not run or reconstruct the transaction.

Only after `complete` should a project run its full tool suite once, inspect the cumulative engine diff, perform authorized repository actions, and write one durable handoff or history update.

## Authority Boundary

The project adapter owns artifact discovery, file hashing, project checks, freshness, source evidence, composed execution, retained-session replacement, telemetry cadence, and atomic publication. Burnlist validates normalized arithmetic, required identities, result consistency, and trust state. It never receives raw reports, raw state bodies, replays, source files, commands, or engine diffs.

Target selection remains source-owned and exact-first. Carrier, render, lifetime, diagnostic, derived, and uncovered rows must be traced upstream. Unknown inputs, substitute configuration, missing provenance, noisy or diagnostic oracles, and unproven edit scope fail closed to evidence work. A smaller error at the same exact coordinate is not progress.

## Shared Design

Differential Testing has one canonical renderer and stylesheet. The field surface uses the same hybrid row for every project:

```text
20% field and status | 10% metric and transitions | 70% paired trace
```

Rows are 90px collapsed and 220px expanded. There is no alternate Cards/Table mode and no project-specific route, schema, title, path, command, or CSS.

The visible surface uses the canonical template's HTML and CSS directly: the Parity Progress table and history chart, Search Fields, Value/Delta, Changed, Failed, pagination, and hybrid rows. Exact authority remains in the validated payload and does not add a separate panel.

The dashboard polls every two seconds. Its revision includes the complete compact retained session, so exact-frontier or evidence-only changes appear without waiting for a new aggregate report or page refresh.

See [Differential Testing Data Contract](../skills/burnlist/references/differential-testing-data.md) for the complete payload and validation rules.
