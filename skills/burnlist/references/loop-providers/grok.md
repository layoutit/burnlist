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
foreground:

```sh
# Read-only review
grok --cwd <absolute-repo-path> --prompt-file <prompt-file> \
  --permission-mode plan --no-memory --no-subagents --disable-web-search \
  --output-format json > <capture-file> 2>&1

# Explicitly authorized write node
grok --cwd <absolute-repo-path> --prompt-file <prompt-file> \
  --permission-mode auto --always-approve --no-memory --no-subagents \
  --disable-web-search --output-format json > <capture-file> 2>&1
```

Add `--model <id>`, `--reasoning-effort <level>`, `--max-turns <n>`, or
`--check` deliberately. The host supervises the process, preserves the full
correlation tuple, verifies the workspace, and constructs the bound report.
Grok never chooses a graph edge. Use only observed telemetry; abandon the claim
if no valid result can be produced.
