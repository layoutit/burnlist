# Differential Testing Adapter SDK

The packaged adapter SDK removes mechanical refresh and publication work without moving project evidence authority into Burnlist.

Locate it with:

```sh
burnlist differential-testing sdk
```

Or import the packaged module directly:

```js
import {
  createDifferentialTestingRefreshQueue,
  createDifferentialTestingWorkerHandler,
  publishDifferentialTestingOvenBundle,
  submitDifferentialTestingRequest,
} from "burnlist/skills/burnlist/scripts/differential-testing-adapter-sdk.mjs";
```

## Refresh Queue

`createDifferentialTestingRefreshQueue(options)` owns only lifecycle mechanics:

- one store lock and one serialized worker across scenarios
- bounded, persisted request-id deduplication
- one coalesced pending successor for a running scenario
- superseded result and error suppression
- restart-safe `queued`, `running`, `complete`, and `failed` state
- scratch-directory cleanup
- optional normalized Oven publication after state changes

Required project callbacks are:

```js
const queue = createDifferentialTestingRefreshQueue({
  stateSchema: "my-project-differential-testing-refresh-state@1",
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
    // Reject branches, regressions, or crossed scenario/runtime identity.
  },
  async runTelemetry({ root, storeDirectory, scratchDirectory, request }) {
    // Run into scratch only. Return { exitCode, staged }; do not publish.
  },
  publishTelemetry({ root, storeDirectory, scratchDirectory, request, staged }) {
    // Synchronously and atomically publish the still-current staged result.
    return { requestId: request.requestId, reportPath: "..." };
  },
});
```

The validated job envelope must contain a non-empty `requestId`, a parseable `requestedAt`, and a lowercase 16-character hexadecimal `scenarioId`. All other job fields and their validation remain project-owned.

`validateStoredJob`, `scenarioIdentity`, `assertCausalSuccessor`, `publishTelemetry`, and `onStateChange` are synchronous. The queue rejects Promise-returning implementations so publication cannot race a newly accepted successor. `runTelemetry` returns `{ exitCode, staged }`; only the queue calls `publishTelemetry`, after confirming that no successor superseded the run. `publishTelemetry` must be an atomic, request-idempotent commit because a process can stop after canonical publication but before refresh-state persistence. A telemetry failure may produce `failed`, but it never reverses an already-retained exact-prefix decision.

One process may own a store at a time. Interrupted `running` jobs are automatically requeued and resumed when the queue is recreated. Call `await queue.idle()` before `queue.close()` during orderly shutdown. Scenario count, serialized job size, and retained request-id history are bounded by conservative defaults and may be lowered with `maxScenarios`, `maxJobBytes`, and `maxAcceptedRequestIds`.

## Signal Client

`submitDifferentialTestingRequest({ endpoint, request })` performs the generic HTTP POST and reports `queued`, `rejected`, or `unavailable`. The project composes and seals the request before calling it. The client does not inspect evidence or retry manually on behalf of an agent.

## Worker HTTP Handler

`createDifferentialTestingWorkerHandler({ queue, serviceName })` returns a Node HTTP request handler with strict read-only health/status routes and POST submission routes at `/api/improvements` and `/api/scenarios`. It enforces a bounded JSON request body and maps project validation errors to their declared HTTP status. The project owns server startup, loopback policy, authentication if required, and the queue callbacks.

## Oven Bundle Publisher

`publishDifferentialTestingOvenBundle(options)` accepts:

- `outputRoot`: the stable symlink path bound by Burnlist
- `currentPayload`: the selected normalized payload, or the explicit empty payload
- `scenarioPayloads`: a `Map` or object keyed by scenario id
- `keepGenerations`: optional retained generation count from 1 through 20

Every payload is checked with the packaged Differential Testing validator. Payload keys must exactly equal all catalog scenario ids, all scenario documents must carry the same catalog, each file must select its own key, and `currentPayload` must exactly equal the selected scenario document. Publication writes a complete generation and atomically switches the stable symlink only after all checks pass.

## Project-Owned Authority

The SDK deliberately does not provide generic implementations for:

- exact comparison or retention
- replay/profile discovery
- runtime-tree or artifact hashing policy
- project checker attestations
- full-scenario command selection
- report/field/producer projection
- causal-successor semantics

These are project facts. An adapter that cannot prove them must publish blocked state rather than configure Burnlist to guess them.
