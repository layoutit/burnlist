# Oven Event Coordination

Use this reference for a portfolio of Burnlists or worker tasks. It defines the progress signal, not project proof and not a new skill. Burnlist ships one `burnlist` skill; coordination is one mode inside it.

## Authority boundary

Canonical task state remains the Burnlist lifecycle folder and shrinking checklist. Canonical Oven evidence remains each adapter's published data. An Oven event is an immutable, observational notification that durable state changed. Never burn an item, accept an implementation, or claim proof from the event alone.

Do not use an AI heartbeat to watch work. A non-model observer may keep the event stream open without spending model tokens. Wake the coordinator only for a real event, a worker decision request, a worker terminal state, or an explicit user check.

## Generic event contract

Every producer uses `burnlist-oven-event@1`:

```json
{
  "schema": "burnlist-oven-event@1",
  "authority": "observational",
  "eventId": "oe1-<sha256>",
  "sequence": 1,
  "ovenId": "future-oven",
  "subjectId": "scenario-or-burnlist-id",
  "kind": "iteration",
  "phase": "complete",
  "cursor": "producer-stable-logical-cursor",
  "occurredAt": "2026-07-21T12:00:00.000Z",
  "payload": {}
}
```

`eventId` is derived from Oven, subject, kind, phase, and cursor. The store assigns a monotonic sequence per repo and Oven. Repeating one logical event is idempotent and the first durable copy wins. Use a new stable cursor for every real progress boundary. Keep payloads compact and JSON-only; paths, captures, source data, secrets, and proof artifacts do not belong in the event.

Publish from JavaScript after canonical state is durable:

```js
import { publishOvenEvent } from "burnlist/oven-events";

publishOvenEvent(repoRoot, {
  ovenId: "future-oven",
  subjectId,
  kind: "iteration",
  phase: "complete",
  cursor: runId,
  payload: { result },
});
```

Shell adapters may use:

```sh
burnlist oven event future-oven \
  --repo <repo> \
  --subject <subject-id> \
  --kind iteration \
  --phase complete \
  --cursor <stable-cursor> \
  --payload '{"result":"advanced"}'
```

Checklist `burn` publishes `item-burned/completed`. Differential Testing SDK v4 publishes one `iteration` event after every persisted telemetry attempt, including retry, terminal failure, completion, or supersession. A future Oven should emit at its own durable unit of progress rather than inventing an Oven-specific supervisor protocol.

## Canonical snapshot invalidation

An Oven that atomically publishes a new canonical data snapshot may emit
`data-published/complete` after the canonical data and binding are durable. Use
the stable Oven subject and a producer-owned durable publication generation as
the cursor. A generation may include the content digest, but must also distinguish
a later X-to-Y-to-X publication while keeping one logical retry idempotent. The
event is only an invalidation: a consumer must reopen and
validate the canonical Oven data, and a failed event publication must not roll
back or falsely fail the canonical write.

```js
import { publishOvenDataPublishedEvent } from "burnlist/oven-events";

publishOvenDataPublishedEvent(repoRoot, {
  ovenId: "future-oven",
  subjectId: ovenId,
  cursor: snapshotGeneration,
  occurredAt: publishedAt,
  payload: {},
});
```

Shell publishers can express the same convention with `burnlist oven event`
using `--kind data-published --phase complete`. Keep the event payload compact;
the canonical snapshot, proof, and source paths stay outside the event store.
Binding, definition, lifecycle, and item-burn CLI mutations likewise publish
their compact observational event only after canonical state commits; a failed
event never changes the canonical command result.

### Canonical dashboard snapshot architecture

All live Ovens render through the declarative `OvenRuntime`; there is no legacy
live renderer. Ordinary JSON handlers use the one process-wide snapshot store
for stable reads, validation, projections, cache limits, ETags, conditional
responses, and backpressure-safe streaming. One process-wide event observer
discovers durable streams in bounded pages, separates the live invalidation tail
from subscriber catch-up, and shares each scan across its listeners. Retention
checkpoints and missing or regressed streams emit an explicit reset that forces
canonical reconciliation. One browser-shell snapshot client owns EventSource,
keyed queries, conditional requests, burst/in-flight coalescing, last-good data,
and reconnect/focus/manual-change reconciliation. Exact consumers use scoped
vector replay; wildcard projections use a non-replay server-tail stream whose
internal paged watermarks remain live beyond the public 64-stream cursor limit,
then conditionally reconcile when the stream opens. Its inactive query cache is
bounded to 16 entries and 64 MiB; stale retained data is labeled, and
authoritative `404`/`410` responses remove it.

Events only remove a matching cached projection. They never eagerly reopen or
parse the canonical file, and handlers must not expose `warm` or
`warmIntervalMs`. The next canonical request performs the read. A failed event
publication therefore leaves a successful canonical write intact; slow server
and browser reconciliation eventually observes the changed file.

The remaining intervals are intentional and regression-allowlisted:

| Owner | Cadence | Reason |
| --- | ---: | --- |
| Process event observer | 500 ms | One live scan and one subscriber catch-up scan, each shared rather than multiplied by listeners. |
| Server projection coordinator | 30 s | Identity-only fallback for manual writes or missed events; never warms data. |
| Browser snapshot client | 30 s | Conditional fallback and reconnect attempt shared by all active queries. |
| Differential Testing log clock | 60 s | Display-only relative-age refresh; performs no I/O. |
| Streaming Diff content SSE | 300 ms / 15 s | Ordered journal delivery and heartbeat for its specialized content protocol. |
| Differential Testing worker | 250 ms default | Project execution inbox, not dashboard snapshot freshness. |

Use `node scripts/measure-oven-snapshot-architecture.mjs` in a Burnlist source
checkout to reproduce real-timer idle, publish-burst, parse, response-byte,
multi-SSE filesystem-scan, and slow/aborted response-admission measurements.

### Specialized transports

Snapshot invalidation does not replace content protocols. Streaming Diff owns an
ordered, producer-managed card/reset SSE feed; it does not publish those cards
inside `data-published` events and must not be routed through the snapshot
observer. Differential Testing keeps bundle, scenario, field-page, and ETag
identities defined by its transport contract, but its source reads, stable
validation, source cache, response-count/byte admission, conditional responses,
and streaming all use the shared canonical JSON snapshot service. Only its
derived query projections remain in a separate bounded 16-entry, 64 MiB LRU.
Performance Tracing revalidates its external provenance files on every canonical
read, so report identity alone is never a cache hit.

## Replayable feed

The dashboard server exposes `GET /api/events`:

- JSON is the default bounded snapshot; `total` counts returned events and `truncated` means one lookahead event existed.
- `Accept: text/event-stream` or `?stream=1` opens Server-Sent Events.
- Repeat `repoKey` and `ovenId` to restrict the subscription.
- Resume with the opaque cursor from the prior SSE `id` or JSON `cursor`, using `Last-Event-ID` or `after=<cursor>`.
- Ignore SSE comments and `observer-error` for work acceptance. Only `oven-event` carries progress.

The event delivery identity is `<repoKey>:<ovenId>:<sequence>:<eventId>`. The replay cursor is a compact vector watermark, so one subscription can resume safely across repos and Ovens even when producer clocks differ. Persist the last handled replay cursor outside model context. Coalesce a burst before waking the coordinator, but do not drop distinct delivery identities.

## Coordination loop

1. Inventory ready and in-progress Burnlists, read their goals, harden weak queues, and choose only genuinely independent work.
2. Open worker tasks only with user authorization. Retain each exact task id, host id if supplied, Burnlist handle, repo root, and assigned scope.
3. Subscribe a non-model observer to the relevant `repoKey` and `ovenId` filters. Do not poll task prose as a heartbeat.
4. On an `oven-event`, read the canonical Burnlist and the exact worker status handle. Wake the coordinator only when there is new work to route, a blocker to resolve, a completed item to verify, or capacity to refill.
5. If a worker stopped while active work remains, inspect its final state. Resume or send a scoped follow-up only when the user's existing authority permits it; otherwise ask the user.
6. As capacity opens, assign the next independent ready Burnlist. Keep overlapping Burnlists serialized.
7. Stop monitoring when every assigned Burnlist is completed, genuinely blocked, or returned to the user.

Do not infer worker status from a stale plan, task title, dashboard row, or event alone. Always reconcile task status, canonical Burnlist state, and the producer's current Oven data.

## Wake bridge boundary

Keep the Codex-specific bridge outside Oven adapters and outside the event schema. A supervisor may hold the SSE connection, persist the replay cursor and handled delivery identities, then use the supported Codex task resume/start interface to wake the coordinator with a compact batch of event identities. The bridge must not wake on keepalives, must deduplicate delivery identities, and must not mutate project or Burnlist state.

This separation keeps future Ovens generic and lets non-Codex consumers use the same feed.
