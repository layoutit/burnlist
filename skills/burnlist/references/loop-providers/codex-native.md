# Codex native recipe

Use only when Codex is the host and its native subagent facility is available.
Read [Host-executed Loop nodes](../host-execution.md) first.

- **Invocation ownership:** Codex normally orchestrates Codex subagents
  natively; Burnlist does not launch them.
- **Context freedom:** forward the exact envelope and any bounded local context
  needed to execute it, without changing authority fields or graph intent.
- **Identity:** carry the complete generic correlation tuple through the
  handoff and final report exactly once.
- **Telemetry:** report observed Codex/model/effort/usage only as
  `host-reported`; retain unavailable values as `null`.
- **Fallback:** execute as the host if native delegation is unavailable. A
  `codex-cli` process recipe is optional for a different host, not required for
  Codex-native execution.
