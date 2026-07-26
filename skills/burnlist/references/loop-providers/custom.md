# Custom host recipe

Use for a host not covered by another recipe. Read
[Host-executed Loop nodes](../host-execution.md) first.

- **Invocation ownership:** the custom host owns all execution, process, and
  cancellation behavior; Burnlist owns no custom runtime plugin.
- **Context freedom:** it may add local context, but must execute the supplied
  envelope unchanged and may not add graph authority.
- **Identity:** propagate the complete generic correlation tuple unchanged into
  the sole final report.
- **Telemetry:** use only observed values with `host-reported`; leave absent
  fields `null`.
- **Fallback:** execute directly if possible; otherwise abandon the live claim
  with a permitted reason. Burnlist never configures or launches the provider.
