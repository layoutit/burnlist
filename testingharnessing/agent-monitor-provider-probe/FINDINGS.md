# Live Provider Findings

Measured on 2026-07-27 in this disposable nested repository:

| Provider | Installed CLI | Strategy supported by evidence |
| --- | --- | --- |
| Codex | 0.145.0 | `direct-learn` from `thread.started.thread_id` |
| Claude Code | 2.1.220 | `direct-set` with `--session-id` |
| Grok | 0.2.101 | `direct-set` with `--session-id` |
| Antigravity | 1.1.7 | token fallback candidate at `PreInvocation` |

`node run-probes.mjs`, `node run-tool-probes.mjs`, and
`node verify-results.mjs` passed for all four installed providers.

## Verified

- All four hook processes inherited the exact launch environment value.
- Codex structured stdout, hook payload, and transcript filename carried one
  identical session ID. Its `PreToolUse` and `PostToolUse` shared a tool-use ID.
- Claude accepted a host-selected UUID. Structured output, hooks, and transcript
  identity matched it exactly. Tool hooks shared a tool-use ID.
- Grok accepted a host-selected UUID. Structured output, native hook payload,
  environment, and session directory matched it exactly. Tool hooks shared a
  tool-use ID and reported `run_terminal_command` with `pwd`.
- Antigravity loaded `.agents/hooks.json` in headless mode only when launched
  with `--add-dir <repo>` after interactive project trust. `PreInvocation`,
  `PostToolUse`, `PostInvocation`, and `Stop` shared one `conversationId`,
  transcript path, and exact `workspacePaths` entry.
- Empty JSON hook output did not alter the Codex, Claude, or Grok `pwd` tool.
  Antigravity used only passive invocation and post-tool hooks because its
  pre-tool contract requires a permission decision.

Observed startup-to-first-hook times in two live runs were approximately:

| Provider | Range |
| --- | --- |
| Claude | 0.44–0.47 seconds |
| Codex | 2.19–2.45 seconds |
| Grok | 2.58–2.65 seconds |
| Antigravity | 3.37–3.96 seconds |

These are evidence samples, not production timeout guarantees.

## Constraints and hazards

- Codex project hooks require trust. The harness uses its explicit hook-trust
  bypass only inside this disposable repository; production must report trust
  state instead of silently bypassing it.
- Antigravity without `--add-dir` reported an empty workspace and loaded no
  project hook. Folder trust was granted through its interactive prompt.
- Antigravity exposes the conversation ID first through the project
  `PreInvocation` hook, not structured stdout. It remains a token-fallback
  candidate until a parent-versus-subagent race probe passes.
- Grok also loaded the compatible `.claude/settings.json` hooks. The same Grok
  session therefore reached both the Grok hook and the nominal Claude hook,
  with `GROK_SESSION_ID` present in both environments. A Claude adapter must
  no-op on Grok-native payload/environment, and observation writes must dedupe.
- Cooperative hooks remain telemetry, not an audit boundary.

Raw stdout, stderr, and hook payloads are ignored under `results/`.
