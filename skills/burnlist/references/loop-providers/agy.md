# AGY recipe

Read [Host-executed Loop nodes](../host-execution.md) first. The host owns the
AGY process; Burnlist never launches or configures it.

Preflight without reading credentials:

```sh
command -v agy
agy models
```

If login is missing, ask the user to run `agy` interactively and complete its
browser OAuth. For a claimed node, put the decoded invocation and bounded
context in a prompt file and run AGY in the foreground:

```sh
# Read-only review
agy --mode plan --sandbox --print-timeout 10m --print "$(cat <prompt-file>)" \
  > <capture-file> 2>&1

# Explicitly authorized write node
agy --mode accept-edits --dangerously-skip-permissions --print-timeout 10m \
  --print "$(cat <prompt-file>)" > <capture-file> 2>&1
```

Add `--model <name>` and `--effort low|medium|high` only when intentionally
selected. The host supervises the process, preserves the complete correlation
tuple, verifies the workspace, and creates the bound report. AGY never chooses
the graph edge. Report only observed telemetry; otherwise use `null`. On
failure, use another host mechanism or abandon the claim.
