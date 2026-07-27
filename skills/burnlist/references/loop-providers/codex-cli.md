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
prompt file, then run one foreground process. Keep the session persisted and
run from the real Git repository so Agent Monitor and project hooks can see it:

```sh
codex exec --json --enable hooks \
  -m <model> \
  -c model_reasoning_effort=<minimal|low|medium|high|xhigh|max> \
  -s <workspace-write|read-only> \
  -C <absolute-repo-path> \
  -- "$(cat <prompt-file>)" </dev/null > <capture-file> 2>&1
```

Use `workspace-write` only for a write-authority task node and `read-only` for
review. Do not add `--ephemeral`: it suppresses the persisted session Agent
Monitor reads. Do not add `--skip-git-repo-check` for an observed Loop; project
hook discovery is rooted in the Git repository. Never use
`--dangerously-bypass-hook-trust` for ordinary work. If Codex reports untrusted
hooks, ask the user to inspect and approve them through Codex's interactive
trust surface.

Keep the process foreground and supervised; never start two writers in one
worktree. Parse the first `thread.started.thread_id` from JSONL and verify later
hook/transcript identity against it when available. Retain the raw value only
in host supervision state: current Burnlist does not yet offer direct external
session binding, so never put it in the worker prompt or host result. Parse the
final answer, verify it against the workspace, and construct the bound host
report yourself. Codex output is not a graph transition and must not replace
any claim identity.

Telemetry is `host-reported`; copy only values actually observed. If the
process cannot finish, abandon the claim rather than fabricating a result.
