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

For native Codex and Claude sessions with Burnlist hooks installed, Monitor
uses the same one-way session hash as the Loop hook context. The selected feed
can therefore show its active Run, item, node, attempt, role, authority, model,
and effort alongside the latest safe action summary. It never exposes raw
session identities through Loop state.

Grok and Antigravity sessions are monitored at repository scope. Exact Loop
node attribution remains unavailable until their host can bind a verified
provider session identifier to the claim; Burnlist must not guess from time,
process order, or the newest transcript.

Do not infer `complete`, `approve`, `reject`, or a graph edge from monitor
activity. Agent Monitor may show commands, edited paths, failures, liveness, or
stalling, but trusted capabilities remain the proof authority and
`burnlist loop submit` remains the semantic transition boundary.
