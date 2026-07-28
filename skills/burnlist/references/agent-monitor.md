# Agent Monitor and Loop supervision

Agent Monitor is an observer, not a worker protocol. Opening its
repository-scoped Oven in the web console or terminal UI automatically acquires
a short renewable service lease. The global observer scans supported local
provider sessions while the view remains open and stops scanning after the
lease expires. `burnlist agent-monitor start` is only needed for manual
diagnostics or standalone producer use.

The worker executing a prepared Loop task does not need the Burnlist skill.
Give it only the `burnlist loop next` task packet and respect the packet's role
and read/write authority. Keep the Burnlist skill and lifecycle commands with
the orchestrating host.

For a native Codex or Claude session that runs the exact hooked
`burnlist loop next|claim` command itself, Monitor uses the same one-way
session hash as the Loop hook context. The selected feed can therefore show
its active Run, item, node, attempt, role, authority, model, and effort
alongside the latest safe action summary. It never exposes raw session
identities through Loop state.

Externally launched Codex, Grok, and Antigravity sessions are currently
monitored at repository scope. Exact Loop-node attribution remains unavailable
until the planned host binding surface ships. Burnlist must not guess from
time, process order, the newest transcript, or a singleton live claim.

Make those sessions observable without claiming attribution:

- Codex CLI: use persisted `exec --json` in the real Git repository, keep
  project hooks enabled and user-trusted, and retain the first
  `thread.started.thread_id` only in host supervision state.
- Grok: pass one fresh host-selected `--session-id` per new conversation and
  verify structured output returns the same UUID. Grok may also execute
  Claude-compatible project hooks; do not edit foreign hooks to suppress it.
- Antigravity: obtain folder trust interactively, then pass
  `--add-dir <absolute-repo-path>` on every headless launch. Without it, the
  tested CLI exposes no workspace and does not load `.agents/hooks.json`.

These are launch requirements, not proof that external Loop binding already
exists. Read the selected `loop-providers/` recipe before invocation.

Do not infer `complete`, `approve`, `reject`, or a graph edge from monitor
activity. Agent Monitor may show commands, edited paths, failures, liveness, or
stalling, but trusted capabilities remain the proof authority and
`burnlist loop submit` remains the semantic transition boundary.
