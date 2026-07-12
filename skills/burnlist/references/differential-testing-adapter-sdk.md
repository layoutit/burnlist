# Differential Testing Adapter SDK v2

The packaged adapter SDK removes mechanical event delivery, telemetry lifecycle, retry, and normalized publication work without moving project evidence authority into Burnlist.

Locate it with:

```sh
burnlist differential-testing sdk
```

Or import the packaged module directly:

```js
import {
  createDifferentialTestingOutboxDispatcher,
  createDifferentialTestingProjectionWorker,
  createDifferentialTestingRefreshQueue,
  createDifferentialTestingWorkerHandler,
  enqueueDifferentialTestingOutboxEvent,
  promoteDifferentialTestingOutboxEvent,
  publishDifferentialTestingOvenBundle,
  stageDifferentialTestingOutboxEvent,
} from "burnlist/skills/burnlist/scripts/differential-testing-adapter-sdk.mjs";
```

SDK v2 is strict. Its refresh queue does not read or migrate v1 refresh state, and its HTTP handler accepts `/api/events` rather than the retired scenario and improvement routes. Projects must publish v2 state explicitly. There is no legacy reader or fallback path.

## Durable Event Outbox

The outbox stores the project's raw event JSON without wrapping it in another SDK envelope:

```text
outbox/
  staged/<requestId>.json
  pending/<requestId>.json
  acked/<requestId>.json
  rejected/<requestId>.json
  dispatcher-state.json
```

Every event must be an object with a lowercase 64-character hexadecimal `requestId` and a parseable `requestedAt`. All other fields and their validation remain project-owned.

Use `stageDifferentialTestingOutboxEvent(options)` before the project commits its retained session. After that commit is durable, call `promoteDifferentialTestingOutboxEvent(options)` to make the event visible to the dispatcher. `enqueueDifferentialTestingOutboxEvent(options)` performs both operations when no surrounding project transaction is required. The helpers use exclusive atomic file creation and synchronize both file data and parent-directory entries before reporting success. Repeating the same request id with identical event content is idempotent; reusing it for different content fails closed.

`createDifferentialTestingOutboxDispatcher(options)` owns delivery mechanics:

- reads only `pending` events and sorts them by `requestedAt`, then request id
- calls `deliver(event, { eventPath, eventSha256 })`
- moves accepted events unchanged into `acked`
- retries transient errors with persisted capped exponential backoff
- moves errors classified as permanent into `rejected`
- recovers an accepted-event crash by reconciling identical pending and acknowledged files
- locks one dispatcher per outbox
- bounds acknowledged and rejected ledgers with `maxAcknowledgedEvents` and `maxRejectedEvents`, both defaulting to 256

The default classifier treats errors with `permanent === true` as permanent and every other delivery error as transient. Projects may provide `classifyDeliveryError(error)` returning `transient` or `permanent`. Call `start()` once for normal polling, `wake()` after a local producer promotes an event when immediate delivery matters, `await idle()` in tests or orderly shutdown, and `close()` after work is idle.

The dispatcher intentionally ignores `staged`. A project that can stop between its domain commit and event promotion must reconcile committed retained sessions with staged events on worker startup before normal dispatch. That reconciliation remains project-owned because the SDK cannot interpret retained-session layouts.

## Refresh Queue

`createDifferentialTestingRefreshQueue(options)` owns only telemetry lifecycle mechanics:

- one store lock and one serialized worker across scenarios
- bounded, persisted request-id deduplication
- one coalesced pending successor for a running scenario
- superseded result and error suppression
- restart-safe `queued`, `running`, `complete`, and `failed` state
- bounded telemetry execution time with an abort signal and a default five-minute timeout
- persisted, attempt-bounded automatic retry for transient telemetry errors
- scratch-directory cleanup
- lightweight projection invalidation after durable state changes

Required project callbacks are:

```js
const queue = createDifferentialTestingRefreshQueue({
  stateSchema: "my-project-differential-testing-refresh-state@2",
  async validateRequest({ root, storeDirectory, request }) {
    // Reopen and validate immutable project artifacts, then return a job.
  },
  validateStoredJob(job) {
    // Reopen and revalidate every persisted artifact binding on restart.
  },
  scenarioIdentity(job) {
    // Return stable project identity including the same scenarioId.
  },
  assertCausalSuccessor({ current, candidate }) {
    // current is null for the first request. Reject invalid initialization,
    // branches, regressions, or crossed scenario/runtime identity.
  },
  async runTelemetry({ root, storeDirectory, scratchDirectory, request, signal }) {
    // Run from the project-sealed immutable input into scratch only.
    // Honor signal by terminating the child process. Do not publish.
    return { exitCode: 1, staged: { reportPath: "..." } };
  },
  publishTelemetry({ root, storeDirectory, scratchDirectory, request, staged }) {
    // Synchronously and atomically publish the still-current staged result.
    return { requestId: request.requestId, reportPath: "..." };
  },
  classifyTelemetryError(error) {
    return error.permanent === true ? "permanent" : "transient";
  },
  invalidateProjection({ revision, reason, scenarioId }) {
    // Persist a lightweight invalidation, normally projection.invalidate(...).
  },
});
```

The validated job envelope must contain a non-empty `requestId`, a parseable `requestedAt`, and a lowercase 16-character hexadecimal `scenarioId`. All other job fields and their validation remain project-owned.

`validateStoredJob`, `scenarioIdentity`, `assertCausalSuccessor`, `publishTelemetry`, `classifyTelemetryError`, and `invalidateProjection` are synchronous. The queue rejects Promise-returning implementations where a durable ordering decision is required. `runTelemetry` receives an `AbortSignal`; the project runner must stop its child process and settle its callback when the signal aborts. After a timeout, the queue waits for that settlement barrier before cleaning scratch or retrying. Only the queue calls `publishTelemetry`, after confirming that no successor superseded the run.

Telemetry timeout and retry defaults are configurable with `telemetryTimeoutMs`, `telemetryAbortGraceMs`, `telemetryMaxAttempts`, `telemetryRetryBaseMs`, and `telemetryRetryMaxMs`. The default abort grace is five seconds and the default attempt budget is five. Timeout and ordinary execution errors are transient by default. Transient failures remain `queued` with a persisted `nextAttemptAt` and retry automatically after restart until the attempt budget is exhausted. A project-classified permanent error fails immediately; exhaustion also becomes terminal `failed` with an explicit error. If the callback does not settle during the abort grace, the queue preserves its scratch directory and emits a permanent `EABORTGRACE` error rather than deleting files under an active child. Backoff is capped, so an unavailable runner does not create a hot loop. Telemetry failure never reverses an already-retained exact-prefix decision.

`publishTelemetry` must be an atomic, request-idempotent commit because a process can stop after canonical publication but before refresh-state persistence. One process may own a store at a time. Interrupted `running` jobs are automatically requeued when the queue is recreated. Call `await queue.idle()` before `queue.close()` during orderly shutdown.

`queue.selectScenario(scenarioId)` selects an already registered scenario, increments and persists the refresh-state revision, and invalidates projection without scheduling telemetry. Re-selecting the current scenario is intentionally idempotent for telemetry but still emits a fresh projection invalidation.

## Asynchronous Projection Worker

`createDifferentialTestingProjectionWorker(options)` separates expensive normalized Oven publication from refresh acceptance and telemetry state writes.

```js
const projection = createDifferentialTestingProjectionWorker({
  statePath: ".local/differential-testing/projection-state.json",
  async publish({ root, revision, reasons, scenarioIds }) {
    // Spawn the project projection command and await it. Publication must be atomic.
  },
});

projection.invalidate({
  revision: "42",
  reason: "exact-session-published",
  scenarioId: "0123456789abcdef",
});
projection.start();
```

`invalidate()` persists and coalesces immediately. It never waits for publication. Repeated reasons for the same revision are deduplicated. An invalidation arriving during publication schedules exactly one successor for the newest revision. Publication errors become persisted `retrying` state with capped exponential backoff, and queued, running, or retrying work resumes after restart. Use `snapshot()`, `start()`, `wake()`, `idle()`, and `close()` for lifecycle control.

The project `publish` callback should spawn a child process or otherwise yield before doing expensive projection work. Calling a large synchronous projector inside an `async` function still blocks the worker process before its first await.

## Worker HTTP Handler

`createDifferentialTestingWorkerHandler({ queue, serviceName })` returns a Node HTTP request handler with strict read-only health and status routes plus one POST submission route at `/api/events`. It enforces a bounded JSON request body and maps project validation errors to their declared HTTP status. The project owns server startup, loopback policy, authentication if required, and the queue callbacks. Local producers should use the durable filesystem outbox instead of treating HTTP availability as event durability.

## Oven Bundle Publisher

`publishDifferentialTestingOvenBundle(options)` accepts:

- `outputRoot`: the stable symlink path bound by Burnlist
- `currentPayload`: the selected normalized payload, or the explicit empty payload
- `scenarioPayloads`: a `Map` or object keyed by scenario id
- `keepGenerations`: optional retained generation count from 1 through 20

Every payload is checked with the packaged Differential Testing validator. Payload keys must exactly equal all catalog scenario ids, all scenario documents must carry the same catalog, each file must select its own key, and `currentPayload` must exactly equal the selected scenario document. Publication writes synchronized compact JSON into a complete generation and atomically switches and synchronizes the stable symlink only after all checks pass.

## Project-Owned Authority

The SDK deliberately does not provide generic implementations for:

- exact comparison or retention
- replay/profile discovery
- runtime-tree or artifact hashing policy
- immutable telemetry snapshot contents
- project checker attestations
- full-scenario command selection
- report/field/producer projection
- causal-successor semantics
- retained-session and staged-event reconciliation
- retention and cleanup of project artifacts

These are project facts. An adapter that cannot prove them must publish blocked state rather than configure Burnlist to guess them.

Before canonical commit, `publishTelemetry` should validate a sealed project proof binding the request id, scenario id, triggering artifact and event kind, exact contract, immutable runtime snapshot, runtime tree, and cleared-frame movement. Scenario initialization uses no baseline; an exact-prefix advancement must prove a strictly later cleared prefix.

Project cleanup must treat every artifact and immutable snapshot referenced by staged, pending, or queued events, the current or pending refresh request, retained exact sessions, canonical manifests, and stable report aliases as pinned. Invalid queue, outbox, or projection state cannot authorize deletion.
