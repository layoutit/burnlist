# Multi Monitor

Multi Monitor is the multi-column conversation workspace for current Codex
sessions across the repositories discovered by the Burnlist service.

## Data Shape

- Input mode: `producer-managed`.
- Runtime validator: `none`.
- Starter data: none.

The input contract is `burnlist-agent-monitor-data@1`; the render contract is
`checklist-progress@1`. Multi Monitor deliberately reuses Agent Monitor's exact
session identity, atomic snapshots, bounded retention, and service lease.

## Route behavior

Open `/r/<repoKey>/o/multi-monitor`. The route repository anchors the page; a
bare route opens caught-up, top-level Codex tasks with activity in the last 30
minutes across every discovered repository. This includes running turns and
freshly completed responses while excluding old feed history, subagents,
provider-qualified sessions, and feeds still catching up. Recent activity is
only an initial-selection rule: mounted columns remain until the user removes
them. Add and remove controls update repeated
`thread=<logicalRepoKey>:<worktreeKey>:<session>` URL fields, preserving exact
cross-repository identity and column order across reloads and shared URLs.
Legacy two-field URLs remain readable. Removing the final column writes
`columns=empty`, so an intentional empty workspace remains empty after reload
and back/forward navigation.

Large or lagging JSONL feeds begin from their latest bounded complete tail
instead of replaying stale history for minutes. The producer counts the skipped
prefix, marks retention as truncated, derives current lifecycle state from the
latest source records, and follows the latest valid turn/tool worktree when a
task began in a temporary folder.

Every column is a literal Codex task surface: user bubbles, assistant prose,
worked-time dividers, edit summaries, and a browser-local draft that survives
reloads. Sending targets only the column's exact, caught-up, top-level,
user-owned Codex task. An idle task uses `turn/start`; a task active on the
shared App Server uses `turn/steer` with the exact active turn id. The composer
clears only after Codex returns that real acknowledgement. A task active in a
different Codex process fails closed and keeps its draft.

Each delivery id is bound with a power-loss-durable atomic write under ignored
`.local/burnlist/multi-monitor-messages/` state before control crosses the
process boundary. Receipts contain a message digest, never message text. An
accepted id replays its receipt; a crash-window id remains uncertain and is
never silently retried. Recent receipts and in-flight work have hard aggregate
and per-thread limits. There is no deferred message queue.

Each column has an independent vertical scroll position. Feed discovery
refreshes while the workspace lease is active, but mounted columns are sticky
and are never removed when a task becomes quiet or completes. The workspace
adds horizontal overflow only when the available width can no longer
accommodate another useful column. The persistent workspace header owns
add-thread actions. Each column has a fixed identity header derived from its
earliest retained user request, with its exact session suffix, live state,
Agent Monitor link, and remove action.

## Privacy boundary

The browser never parses or writes provider JSONL. It reads the same
producer-managed snapshots as Agent Monitor and sends only through a
token-protected, same-origin, loopback controller POST. The server uses Codex
App Server APIs; it never writes a transcript directly. Configure
`--codex-app-server-socket <absolute-path>` (or
`BURNLIST_CODEX_APP_SERVER_SOCKET`) only when Codex Desktop and Burnlist connect
to that same App Server. The installed `burnlist-codex-bridge` executable is
the `CODEX_CLI_PATH` bridge for Codex Desktop: it starts one official Unix
socket App Server and proxies Desktop's stdio connection to it. Burnlist
auto-discovers that default socket after both processes restart. Without shared
ownership, the composer remains a durable local draft and refuses all sends.
App Server approvals and user-input requests are rendered in the originating
column; unanswered or unsupported requests fail closed instead of stalling.
The producer retains bounded, secret-redacted user and assistant display
messages; reasoning, raw commands, and raw tool output remain withheld.

The declarative Oven defines one chronological conversation stream. The route
host composes several controlled instances of that same Oven runtime; it does
not inject executable UI or mutate canonical Burnlist state.
