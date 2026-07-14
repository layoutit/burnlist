# Streaming Diff

Streaming Diff renders one task's timestamped repository changes as a review feed. It does not execute code, watch files, infer authorship from filesystem events, or mutate project state.

## Capture Contract

The trusted Codex lifecycle hook owns capture. It receives the active `session_id` and `turn_id`, snapshots the repository around ordinary tool calls, computes changed files, and atomically publishes `burnlist-streaming-diff-data@2` under that thread's ignored local state.

Agents keep their normal editing workflow. Never ask an agent to announce edits, run a capture command, select changed files, or publish a global repository feed.

Every change must carry the same thread id as its feed plus the originating turn and tool identity. Never merge, search, poll, or fall back to another thread's feed. A missing or mismatched identity is an error.

## Viewer Attachment

Each browser tab owns an ephemeral viewer id. **Attach this task** reads the loopback-only catalog of active hook-published feeds. When exactly one feed is active it attaches immediately. When several are active it shows their prompt-derived labels and last activity so the user can select the intended task.

The agent never claims a viewer and never changes its normal editing workflow. The selected tab-to-thread binding stays exact. Once attached, Server-Sent Events are the only transport; there is no polling or generic Oven-data fallback.

The connected status is also the explicit disconnect control. Disconnecting deletes only that viewer's ephemeral binding and leaves the thread feed untouched.

## Review Feed

Render newest changes first. Each timestamped card shows only changed hunks with nearby context, source line numbers, additions, and deletions. Offer unified and split layouts. Keep the presentation flat, readable, and free of decorative borders.
