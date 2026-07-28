# Agent Monitor Provider Probe

This in-repository harness measures the installed Codex, Claude, Grok, and
Antigravity CLI contracts used by `AGENT_MONITOR_PLAN.md`.

It captures only:

- provider hook payloads;
- whether a fixed non-secret probe environment value reached the hook;
- hook timing;
- structured CLI output needed to identify a session.

The passive prompt asks for the exact text `PROBE_OK` and forbids tool use. The
tool prompt runs only `pwd`; the nested repository isolates provider discovery.
Raw runs and captured events stay under `results/`.

Run `node run-probes.mjs` from this directory. The runner creates a temporary
nested Git boundary for provider discovery, launches providers sequentially,
removes that boundary, and writes `results/summary.json`.
Run `node run-tool-probes.mjs` to verify tool identity and neutral hook output.
Then run `node verify-results.mjs` for mechanical assertions.

The Claude config is stored as a fixture and materialized only during a run so
local `.claude/` ignore rules cannot hide harness source from version control.

Codex uses its explicit hook-trust bypass only for this disposable harness.
Antigravity requires the folder to have been trusted interactively and requires
`--add-dir` in headless mode so project hooks and workspace identity are loaded.
