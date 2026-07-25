# Grok recipe

Use only when Grok is available to the host. Read
[Host-executed Loop nodes](../host-execution.md) first, and defer to an
installed Grok skill for its current invocation syntax.

- **Invocation ownership:** the host invokes and supervises Grok; Grok is not a
  Burnlist-managed adapter.
- **Context freedom:** select Grok session mechanics while retaining the exact
  prepared envelope as the only transition-relevant input.
- **Identity:** preserve the full generic correlation tuple and bind the final
  report to it without reconstruction.
- **Telemetry:** emit Grok/model/usage only when known, as `host-reported`;
  unknown values are `null`.
- **Fallback:** use a native host path, a deliberately configured Codex CLI
  recipe, or abandon the claim. Do not promise Grok as a managed Loop backend.
