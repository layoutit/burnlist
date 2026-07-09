# Target

Target is the default evidence-backed metric-to-goal Oven. It applies source-backed convergence discipline and answers: how close is the current machine-reported value to its explicit target at the active gate?

The goal is to improve the real measured system, not make a chart look better.

## State Contract

Canonical state lives in repo-local machine reports plus a compact checkpoint and an append-only cycle ledger when the workflow spans multiple cycles. The dashboard reads normalized data from those artifacts; it is never the source of measurement, task state, or patch permission.

The checkpoint records the active gate, current comparable metric, current candidate, latest report and focused evidence paths, last cycle outcome, and exact next action. The ledger records each kept, reverted, no-patch, or blocked cycle with its comparable gate result without replacing prior history.

## Run Inputs

A Run needs a repository, a concise title, and an objective. The objective must name:

- the machine report or measurement source
- the explicit target and its lower, higher, exact, or range-bound direction
- the active gate and any ordered gate ladder
- the command or procedure that produces a comparable measurement
- existing checkpoint and ledger paths, when present

These inputs stay in the generic objective; Target does not add a domain-specific manifest schema.

## Evidence Priority

Use evidence in this order:

1. source facts, reference-oracle output, and raw machine artifacts
2. focused producer, provenance, dependency, or root-cause packets
3. comparable gate reports and their machine-readable metrics
4. dashboard views only as reader evidence

If compact evidence may be stale, missing, transformed, or lifecycle-shifted, obtain raw comparable evidence before changing implementation or report mapping.

## Active Gate

Work only the active gate. Do not advance to a larger, longer, or stricter gate until the current one passes its declared target. Compare results only with a previous run from the same gate, profile, input, and measurement mode.

A passing gate satisfies the declared target with no hidden failures. For an exact-match target, that means zero real failures.

## Candidate Selection

Choose the next candidate from compact source-backed or machine-backed decision evidence, not from the loudest dashboard row. Start at the earliest failure, then trace upstream until the candidate owns the behavior and is narrow enough to verify.

Treat visible failures as symptoms until evidence classifies them. Useful classes include edit candidate, input trace, carrier, render or lifetime symptom, diagnostic, coverage gap, and downstream symptom. Carriers and repeated wrapper rows should be collapsed to their earliest primitive producer instead of consuming one cycle each.

## Change Permission

Make at most one narrow change per cycle, and only when all are true:

1. The candidate owns the behavior in the source or reference model.
2. It is the earliest proven actionable producer for the current failure window.
3. Same-frame or same-sample inputs distinguish a producer bug from carried drift.
4. Required configuration, constants, and lifecycle provenance are source-backed.
5. The active gate can prove or reject the change.

When proof is missing, trace evidence, harden the measurement tooling, or record a no-patch cycle. Do not guess a system change.

## Cycle

1. Read the checkpoint and latest machine report from disk.
2. Confirm the active gate and previous comparable metric.
3. Read the compact candidate decision, then only the focused evidence it requests.
4. Select one source-owned, edit-ready candidate or choose trace/tool/no-patch work.
5. Make one narrow change when permission is proven.
6. Run narrow checks and the active gate.
7. Revert exactly that change and rerun the gate if the metric worsens or hard invariants fail.
8. Rewrite the compact checkpoint and append one ledger entry.
9. Restart the next cycle from disk evidence, not chat memory.

## Results

Record one cycle outcome:

- `kept`: an evidence-backed change passed required checks and was retained
- `reverted`: a change worsened the metric or broke an invariant, so it was reverted and the gate rerun
- `no-patch`: evidence did not justify a safe implementation change
- `blocked`: required evidence is contradictory or unavailable and no meaningful trace expansion remains

Report the comparable gate direction separately:

- `pass`: the active gate reached its declared target
- `improved`: the comparable residual moved toward target
- `unchanged`: the comparable residual did not move
- `worsened`: the comparable residual moved away from target

Never call a gate passed because thresholds were loosened, failures hidden, missing values replaced with fake zeros, rows excluded, or diagnostics relabeled. Report/tool improvements are useful but are not system-behavior wins unless the comparable target metric also improves.

## Detail Page Data

The normalized detail payload may expose:

- `summary.gate`, `summary.current`, `summary.target`, and `summary.status`
- `history` for comparable measurements at the same gate
- `decision` for the current candidate and patch-permission evidence
- `cycles` for compact ledger results
- `evidence` for report, packet, source, and validation paths

Detail-block bindings use JSON-pointer-like source paths and never execute code from these instructions.
