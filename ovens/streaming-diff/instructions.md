# Streaming Diff

`streaming-diff.oven` is the declarative, read-only selected-feed view for
recently published, session-scoped pre-to-post diff cards. It renders the
heading and diff cards through the `.oven` engine, byte-for-byte identical to
the selected-feed component view.

## Data Shape

- Input mode: `producer-managed`.
- Runtime validator: `none`.
- Starter data: none.

Streaming Diff does not accept one JSON document: `oven set streaming-diff` is
refused. Its runtime handler reads the producer-owned
`burnlist-streaming-diff-data@2` feed root, validates contained manifest/card
identity through the journal contract, and serves a selected snapshot or SSE
updates. There is no `example/data.json`, so `oven use streaming-diff` adopts
without data or a binding; the feed producer establishes its own binding.

The view binds `burnlist-streaming-diff-data@2` after `adaptStreamingDiff(snapshot)`.
The adapter provides the feed identity, update time, normalized cards, and the
back link used by the heading. `StreamingDiffHeading` and `DiffCardList` reuse
the existing `DiffCard` and `FileDiff` rendering components.

The dashboard is a read-only observer: it never mutates canonical Burnlist
state, lifecycle folders, the registry, or the feed. The feed is snapshot
pollable; the `.oven` engine does not require SSE.
