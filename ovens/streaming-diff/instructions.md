# Streaming Diff

`streaming-diff.oven` is the declarative, read-only selected-feed view for
recently published, session-scoped pre-to-post diff cards. It renders the
heading and diff cards through the `.oven` engine, byte-for-byte identical to
the selected-feed component view.

## Payload contract

The view binds `burnlist-streaming-diff-data@2` after `adaptStreamingDiff(snapshot)`.
The adapter provides the feed identity, update time, normalized cards, and the
back link used by the heading. `StreamingDiffHeading` and `DiffCardList` reuse
the existing `DiffCard` and `FileDiff` rendering components.

The dashboard is a read-only observer: it never mutates canonical Burnlist
state, lifecycle folders, the registry, or the feed. The feed is snapshot
pollable; the `.oven` engine does not require SSE.
