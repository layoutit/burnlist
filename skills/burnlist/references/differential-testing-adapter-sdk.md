# Differential Testing Adapter SDK v4

The SDK owns generic asynchronous worker mechanics without owning project evidence authority.

Import the strict package subpath:

```js
import {
  DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA,
  createDifferentialTestingWorker,
} from "burnlist/differential-testing";
```

Payload validators and deterministic contract helpers use the separate stable subpath:

```js
import {
  assertDifferentialTestingData,
  buildDifferentialTelemetry,
  differentialStateVectorSha256,
} from "burnlist/differential-testing/contract";
```

Projects publishing very large field sets can validate the canonical indexed bundle without reconstructing one monolithic payload:

```js
import {
  assertDifferentialTestingBundle,
  queryDifferentialTestingFieldPage,
} from "burnlist/differential-testing/transport";
```

The project still owns atomic bundle publication. The transport helper validates contained bindings and normalized records, then range-reads only the requested page; it never runs project evidence generation.

V4 has one durable inbox supplied by the project, one `state.json`, one worker lock, and one runtime. There is no staged/pending/acked/rejected tree, separate dispatcher state, separate projection state, legacy reader, migration, or fallback. After each persisted telemetry attempt it also publishes one generic observational Oven event; the event never becomes evidence authority.

## Project contract

```js
const worker = createDifferentialTestingWorker({
  root,
  readInbox,        // returns [{ event, eventPath, ... }]
  deleteInbox,      // deletes one accepted/rejected entry durably

  describeEvent,    // returns the exact descriptor below
  validateRequest,  // converts a telemetry event into an immutable job
  validateStoredJob,
  validateStoredSession,
  scenarioIdentity,
  validateScenarioIdentity,
  assertCausalSuccessor,

  runTelemetry,
  publishTelemetry,
  classifyTelemetryError,
  project,
  emitOvenEvent,      // optional synchronous test/custom transport seam
  onOvenEventError,   // optional non-fatal observer error reporting
});
```

`describeEvent({ root, event, entry })` is synchronous and returns exactly:

```js
{
  requestId,        // lowercase SHA-256 digest
  requestedAt,      // timestamp
  scenarioId,       // lowercase 16-character hexadecimal id
  kind,             // project event kind
  session,          // opaque durable project session binding
  telemetry,        // true to queue telemetry; false for projection-only
}
```

The SDK stores `session` verbatim after validation. A projection-only event must target an existing scenario; it updates the selected scenario, latest session, and event without running telemetry.

The project remains authoritative for event/session/job validation, replay and exact-comparison evidence, scenario identity, causal successor rules, telemetry execution, canonical report publication, and Oven payload contents.

## Generic guarantees

The SDK owns:

- inbox polling and request-id deduplication
- state-before-delete durability
- one serialized telemetry execution across scenarios
- one coalesced successor for a running scenario
- timeout with abort grace and quarantine of an uncooperative runner
- bounded transient retries for telemetry and projection
- restart recovery from interrupted telemetry and projection
- one atomic `state.json` using `burnlist-differential-testing-worker-state@1`
- one process lock per store
- asynchronous projection scheduling after accepted events and telemetry transitions
- one idempotent `differential-testing/iteration` Oven event after each persisted telemetry attempt

`runTelemetry` receives an `AbortSignal` and writes only to its scratch directory. `publishTelemetry` is synchronous and must atomically publish a result whose `requestId` matches the still-current job. Telemetry never controls exact-prefix retention.

The worker API is:

```js
worker.statePath
worker.snapshot()
worker.scenarioStatus(id)
worker.start()
await worker.poll()
await worker.idle()
worker.close()
```

Use `onFatal(error)` to terminate a service host when persistence, callback configuration, or abort quarantine makes continued in-process execution unsafe. A restart reopens the last durable state and leaves the inbox event available when acceptance was not persisted.

The default event publisher writes through `burnlist/oven-events` under ignored repo-local state. Event publication failure calls `onOvenEventError(error, identity)` and does not roll back canonical worker state. Read `references/oven-event-coordination.md` before subscribing a coordinator.
