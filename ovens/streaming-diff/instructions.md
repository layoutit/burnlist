# Streaming Diff

Streaming Diff is a declarative, read-only Oven for recently published,
session-scoped pre-to-post diff cards. Producers write immutable cards to the
local feed; the dashboard observes them through the Oven data endpoint.

Select a feed with its logical repository key, worktree key, and session. A
feed's activity time indicates recent publication only; it does not indicate
that an agent or process is live.

This package contains no executable renderer, hook, or producer code. The
server-side adapter validates and reads the local feed without mutating it.
