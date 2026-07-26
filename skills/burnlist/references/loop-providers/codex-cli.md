# Codex CLI recipe

Read [Host-executed Loop nodes](../host-execution.md) first. The host owns the
Codex process; Burnlist never launches or configures it.

## Preflight

```sh
command -v codex
codex --version
```

If authentication is missing, ask the user to run `codex login`. Do not inspect
credential files.

## Invoke

Put the decoded prepared invocation plus bounded supplemental context in a
prompt file, then run one foreground process:

```sh
codex exec --json --ephemeral \
  -m <model> \
  -c model_reasoning_effort=<minimal|low|medium|high|xhigh|max> \
  -s <workspace-write|read-only> \
  -C <absolute-repo-path> \
  --skip-git-repo-check \
  -- "$(cat <prompt-file>)" </dev/null > <capture-file> 2>&1
```

Use `workspace-write` only for a write-authority task node and `read-only` for
review. Keep the process foreground and supervised; never start two writers in
one worktree. Parse its final answer, verify it against the workspace, and
construct the bound host report yourself. Codex output is not a graph
transition and must not replace any claim identity.

Telemetry is `host-reported`; copy only values actually observed. If the
process cannot finish, abandon the claim rather than fabricating a result.
