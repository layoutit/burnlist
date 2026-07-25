# AGY recipe

Use only when AGY is available to the host. Read
[Host-executed Loop nodes](../host-execution.md) first, and defer to an
installed AGY skill for its current invocation syntax.

- **Invocation ownership:** the host invokes and supervises AGY; AGY is not a
  Burnlist-managed adapter.
- **Context freedom:** choose AGY's prompt and session mechanics while carrying
  the exact prepared envelope as the authority-bearing input.
- **Identity:** preserve the complete generic correlation tuple through AGY and
  bind its final result to that tuple.
- **Telemetry:** use AGY data only when actually returned and label it
  `host-reported`; otherwise leave it `null`.
- **Fallback:** use native host execution, Codex CLI where deliberately
  configured, or abandon the claim. Never invent provider output or a graph
  transition.
