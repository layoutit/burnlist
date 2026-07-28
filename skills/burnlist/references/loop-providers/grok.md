# Grok recipe

Read [Host-executed Loop nodes](../host-execution.md) first. The host owns the
Grok process; Burnlist never launches or configures it.

Preflight without reading credentials:

```sh
command -v grok
grok models
```

If login is missing, ask the user to run `grok login`. For a claimed node, put
the decoded invocation and bounded context in a prompt file and run Grok in the
foreground. Allocate one fresh UUID per new process and retain it only in host
supervision state:

```sh
# Read-only review
grok --cwd <absolute-repo-path> --prompt-file <prompt-file> \
  --session-id <fresh-session-uuid> \
  --permission-mode plan --no-memory --no-subagents --disable-web-search \
  --output-format json > <capture-file> 2>&1

# Explicitly authorized write node
grok --cwd <absolute-repo-path> --prompt-file <prompt-file> \
  --session-id <fresh-session-uuid> \
  --permission-mode auto --always-approve --no-memory --no-subagents \
  --disable-web-search --output-format json > <capture-file> 2>&1
```

Add `--model <id>`, `--reasoning-effort <level>`, `--max-turns <n>`, or
`--check` deliberately. The host supervises the process, preserves the full
correlation tuple, verifies the workspace, and constructs the bound report.
The final structured session ID must equal the host-selected UUID. Do not put
that raw UUID in the worker prompt or host result.

The tested Grok CLI also loads compatible `.claude/settings.json` hooks. Do not
delete, rewrite, or disable Claude hooks to avoid that duplication. Current
Burnlist treats external Grok Monitor activity as repository-scoped until
direct session binding ships; a nominal Claude hook receiving Grok's camelCase
payload must remain a neutral no-op. Grok never chooses a graph edge. Use only
observed telemetry; abandon the claim if no valid result can be produced.
