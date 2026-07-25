# Codex CLI recipe

Read [Host-executed Loop nodes](../host-execution.md) first. There are two
different Codex CLI paths; never describe a direct host launch as the managed
adapter.

## Managed `builtin:codex-cli`

- **Invocation ownership:** the Burnlist runner launches and cancels the
  configured process through `loop run` or `loop resume`; the host does not
  claim/report that managed invocation.
- **Context and identity:** the runner supplies the frozen input and preserves
  its identity internally; neither the child nor a supervising host selects an
  edge.
- **Telemetry:** runner measurements are `managed`; missing values are
  unavailable, not inferred.
- **Fallback:** if managed setup is unavailable, use native host orchestration
  or the direct host-claim path below; do not call that fallback an adapter.

## Direct Codex CLI for a host claim

- **Invocation ownership:** the host launches, supervises, and cancels its own
  Codex CLI process after `burnlist loop claim`; this is not `builtin:codex-cli`.
- **Context freedom:** give Codex the exact decoded invocation input and only
  bounded supplemental context. Do not ask it to choose a transition.
- **Identity:** retain the complete generic correlation tuple and submit the
  one bound host report under the original claim id.
- **Telemetry:** observations from this host-owned process are
  `host-reported`; unavailable fields are `null`.
- **Fallback:** use native Codex orchestration, another available host
  mechanism, or abandon the claim. `builtin:codex-cli` remains the only
  Burnlist-managed process adapter, not the only way a Loop node can run.
