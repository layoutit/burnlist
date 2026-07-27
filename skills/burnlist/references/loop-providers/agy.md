# AGY recipe

Read [Host-executed Loop nodes](../host-execution.md) first. The host owns the
AGY process; Burnlist never launches or configures it.

Preflight without reading credentials:

```sh
command -v agy
agy models
```

If login is missing, ask the user to run `agy` interactively and complete its
browser OAuth.

AGY workspace activation is separate from login. Before its first Loop use in
a repository, ask the user to open AGY interactively for that exact folder and
approve the folder-trust prompt. Never write or spoof AGY's trust files. Every
headless invocation must include `--add-dir <absolute-repo-path>`: without it,
the tested CLI reports no workspace and does not load the repository's
`.agents/hooks.json`.

For a claimed node, put the decoded invocation and bounded context in a prompt
file and run AGY in the foreground:

```sh
# Read-only review
agy --add-dir <absolute-repo-path> --mode plan --sandbox \
  --print-timeout 10m --print "$(cat <prompt-file>)" \
  > <capture-file> 2>&1

# Explicitly authorized write node
agy --add-dir <absolute-repo-path> --mode accept-edits \
  --dangerously-skip-permissions --print-timeout 10m \
  --print "$(cat <prompt-file>)" > <capture-file> 2>&1
```

Add `--model <name>` and `--effort low|medium|high` only when intentionally
selected. The host supervises the process, preserves the complete correlation
tuple, verifies that hook `workspacePaths` names exactly the assigned
repository when available, and creates the bound report. AGY's tested
`PreInvocation` hook exposes a stable `conversationId`, but current Burnlist
does not yet bind that identity to an externally launched Loop node. Treat
Monitor activity as repository-scoped, never infer the node from timing, and
do not add the raw conversation ID to the host result. AGY never chooses the
graph edge. Report only observed telemetry; otherwise use `null`. On failure,
use another host mechanism or abandon the claim.
