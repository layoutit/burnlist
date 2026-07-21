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

## Replayable feed

The dashboard server exposes `GET /api/events`:

- JSON is the default bounded snapshot.
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
