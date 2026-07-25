# Claude native recipe

Use only when Claude is the host and its native subagent facility is available.
Read [Host-executed Loop nodes](../host-execution.md) first.

- **Invocation ownership:** Claude hosts and supervises its own Claude
  subagent; Burnlist does not launch it.
- **Context freedom:** pass the exact claim envelope unchanged plus concise,
  non-authoritative working context. Do not substitute a new item, candidate,
  or destination.
- **Identity:** preserve every field in the generic correlation tuple in the
  subagent handoff and copy them unchanged into the final bound report.
- **Telemetry:** report provider values only when Claude exposes them; label
  them `host-reported`, otherwise use `null`.
- **Fallback:** if native delegation is unavailable, execute directly as the
  Claude host or use another available mechanism, then follow the same report
  and abandonment rules. Burnlist never configures or launches Claude.
