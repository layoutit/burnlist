# Agent Monitor

Agent Monitor is the declarative, read-only statistics view for supported agent
sessions associated with a repository.

## Data Shape

- Input mode: `producer-managed`.
- Runtime validator: `none`.
- Starter data: none.

The input contract is `burnlist-agent-monitor-data@1`; the render contract is
`checklist-progress@1`.

## Producer boundary

- Opening the repository-scoped Oven in the web or terminal UI acquires a
  renewable service lease. The service discovers Codex, Claude, Antigravity,
  and Grok sessions while the view remains open.
- `burnlist agent-monitor start` remains available for manual diagnostics and
  standalone producer use. Limit it with `--providers codex,claude,agy,grok`.

The repository-scoped producer discovers recent Codex JSONL files from their
recorded `session_meta.payload.cwd`. It never selects a thread by "newest file"
and does not accept a pinned session in daemon mode. Each exact Codex
`session_id` is published to its own ignored feed directory.

Every update commits an immutable canonical snapshot and an atomic manifest
before publishing a compact `data-published` invalidation. The dashboard is
read-only and never parses Codex JSONL directly.

## Route behavior

Open `/r/<repoKey>/o/agent-monitor`. One recent feed opens automatically.
Several recent feeds produce an explicit session list. A selected route carries
the exact `worktreeKey` and `session` identity.

For an automatic Codex handoff, Codex supplies its exact thread id to
`burnlist agent-monitor url --session <id>` and navigates to the returned URL.
In a side conversation, the Codex integration may deliberately supply the
parent thread id. Burnlist validates the repository/worktree/session identity;
it never reads a global "current thread" pointer, guesses the newest JSONL, or
asks the dashboard to infer which Codex window is adjacent.

The view reuses existing KPI, alert, collection, and pagination components. It
shows a bounded latest-first event page plus explicit Live/Idle and drift state.
When a Codex or Claude native session claimed a Loop node through installed
Burnlist hooks, the current card is attributed to that Run, item, node, attempt,
role, and authority. Grok and Antigravity remain repository-scoped until their
host supplies a verifiable session-to-claim binding. Observation never chooses
a Loop edge or reports a semantic outcome.
It has no custom renderer, executable Oven code, write controls, or legacy
single-file data binding.

## Privacy and retention

Reasoning, conversation bodies, raw commands, and raw tool output remain
private. The feed keeps one user-instruction marker and bounded, redacted agent
updates, while collapsing duplicate message envelopes and routine successful
tool-result envelopes. Command cards expose a secret-redacted intent summary
(targets, searches, checks, and test names), and a tool result completes its
originating action with done/failed status. Each feed retains at most 256 useful
monitorable events while preserving cumulative counts. The canonical manifest
commits the source cursor with the snapshot, so producer-mirror loss cannot
replay events.
