# Performance Tracing

Performance Tracing renders retained browser-output timing evidence from a project-owned trace run. It shows frame pacing, synchronous step cost, budget checks, renderer trace groups, slow steps, browser identity, and source provenance without treating instrumentation as gameplay or visual-equivalence authority.

## Data Shape

- Input mode: `json-payload`.
- Runtime validator: `validatePerformanceTracingRuntimeData`.
- Starter data: none.

The runtime validator is the authority used by both `oven set` and the render
handler. It requires a `performance-tracing-oven@1` report with run identity,
trust boundary, metrics, browser and scenario, reconciled verdict checks,
artifacts, current source-file provenance, diagnostics, and optional retained
runs and history. Provenance files are re-hashed beside the bound report, so a
structurally valid but stale report is rejected. There is no
`example/data.json`, so `oven use performance-tracing` adopts without data.

## State Contract

The project publishes one atomic `performance-tracing-oven@1` JSON report. The report owns capture, deterministic replay, raw Chrome trace retention, samples, machine and browser provenance, and budget evaluation. Burnlist validates and renders that normalized report; it does not execute the trace command or rewrite project evidence.

The report must preserve:

- canonical prepared route and scenario identity
- browser, viewport, machine, and source-file provenance
- startup, frame, synchronous step, trace-group, and residency measurements
- bounded per-dispatch phase attribution with source producer and next-probe metadata
- ranked frame spikes, residency-changing step spikes, trace hot windows, and top complete events
- a measured optimization queue whose items name the producer, evidence, next action, and verification metrics
- comparable-history context plus the exact command and integrity gate for the next rerun
- every declared budget with its actual value and pass/fail result
- raw trace and sample artifact bindings
- explicit browser-output trust that makes no native-execution or visual-equivalence claim

Missing, malformed, partially written, contradictory, or unactionable evidence is blocked. Never guess a producer and never loosen a budget to make a run green. Fix the capture boundary when observer overhead dominates; otherwise change one measured source producer, run the retained comparable command again, require the same comparison key and zero integrity violations, and keep the change only when the named acceptance metrics improve without structural regressions.

## Execution Boundary

The Oven is read-only. Project tooling runs traces and atomically publishes the report. Burnlist only validates and displays it.

## Rendering

Performance Tracing is authored as the clean semantic
`ovens/performance-tracing/performance-tracing.oven`. It renders through the
React OvenRuntime engine while reusing the differential-testing theme,
components, formats, and adapter. The DOM-golden gate at
`dashboard/src/oven/runtime/performance-tracing-oven-dom-golden.test.mjs`
verifies the rendered PT main state is byte-for-byte identical to the frozen
`pt-main` golden.
