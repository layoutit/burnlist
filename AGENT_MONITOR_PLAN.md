# Agent Monitor and Loop Correlation Plan

Status: Revised after adversarial review
Updated: 2026-07-27
Scope: Cooperative Codex, Claude, Grok, and Antigravity activity attribution
without giving workers Burnlist lifecycle authority.

## Bottom Line

Agent Monitor is cooperative telemetry, not a forensic audit trail.

- The orchestrator keeps the Burnlist skill and owns `loop next`, provider
  launch, supervision, and `loop submit`.
- Workers receive provider-neutral task prompts and run no Burnlist lifecycle
  commands. Installed native hooks may still invoke a bounded Burnlist
  observation helper on their behalf.
- A worker can disable hooks, edit a project hook, fabricate hook input, expose
  its environment, or avoid observation. Monitor data therefore cannot prove
  that a reviewer was read-only, that a worker was honest, or that an outcome
  is valid.
- Monitor activity may explain cooperative work. It may never complete an
  item, approve a review, choose an edge, satisfy a gate, or become proof.

The preferred correlation mechanism is direct host-side session binding. A
single-use environment token is admitted only as a per-provider fallback after
live contract probes show that the host cannot set or learn that provider's
session identity directly.

## Grounded Current State

The repository currently:

- discovers Codex, Claude, Grok, and Antigravity transcripts;
- installs native hooks only for Codex and Claude;
- accepts only Codex and Claude in Loop hook normalization;
- binds a session when that same session runs `burnlist loop next|claim`;
- gives an externally launched worker only `task.prompt`, so the current
  heuristic can bind the orchestrator rather than the worker.

The isolated live harness at
`testingharnessing/agent-monitor-provider-probe/` confirms:

| Provider | Proven strategy | Exact identity evidence | Hook constraint |
| --- | --- | --- | --- |
| Claude | `direct-set` | flag = stdout = hooks = transcript | project config |
| Grok | `direct-set` | flag = stdout = hooks = session dir | also loads Claude hooks |
| Codex | `direct-learn` | first JSON event = hooks = transcript | project trust |
| Antigravity | token candidate | hook conversation = transcript | trust + `--add-dir` |

All four inherited the exact launch environment. Codex, Claude, and Grok
executed a harmless `pwd` with matching pre/post tool identity and neutral hook
output. Antigravity exposes `conversationId` at the passive `PreInvocation`
hook and keeps it through post-tool/invocation/stop events. It does not expose
a host-selected or structured-stdout identity, so its fallback remains
conditional on a parent/subagent race proof.

Grok executed both its native `.grok` hook and the compatible
`.claude/settings.json` hook. Provider adapters must recognize Grok-native
payload/environment on the nominal Claude path, no-op there, and dedupe the
native observation.

## Threat Model

Correlation protects against accidental cross-binding among honest concurrent
workers. It does not defend against a worker controlling its own process tree
or repository hook files.

Consequences:

- Session attribution is labelled `cooperative`.
- Hook absence, tampering, timeout, trust failure, identity uncertainty, or
  binding drift yields `unattributed`; Burnlist never guesses.
- Observation is excluded from semantic authority and read-only-review proof.
- A fallback token's entropy, expiry, and one-time use prevent accidental
  reuse. They do not authenticate a hostile worker that can read the token and
  invoke the observation helper first.

## Correlation Strategy Order

### 1. Direct host binding

Use direct binding whenever the host can choose or learn the real provider
session:

```text
burnlist loop observe bind <RunRef> --provider <id> --session <id>
```

The command validates the live Run/node/attempt and repository, stores only a
provider-qualified session digest, and never adds authority to the session.

- Claude and Grok: generate a UUID before launch, pass the provider's native
  session flag, then bind that exact UUID.
- Codex: if the initial structured launch event exposes the session ID, bind
  immediately after reading that event.
- Antigravity did not expose a structured launch identity in the tested CLI.
  Keep direct binding available if a future version adds one.

No secret, hook-consumption race, or correlation expiry is needed on this
path.

### 2. Single-use launch handoff

Use this only for Antigravity after its remaining parent/subagent race probe,
or for a future provider proven unable to support direct binding:

```text
burnlist loop observe prepare <RunRef> --provider <id>
```

Burnlist returns a random, single-use observation token in host-only metadata.
It stores only a digest bound to the live Run/node/attempt/claim/invocation,
repository, provider, and an expiry derived from measured provider startup.
The host passes the token through a dedicated environment variable.

The earliest verified parent-session hook consumes the token and binds its
provider/session digest. If the provider cannot distinguish the intended parent
before a subagent can race it, that provider is ineligible for token binding.

Safety does not rely on secrecy after launch. Burnlist keeps the raw token out
of prompts, argv, events, snapshots, and semantic inputs; performs exact-value
redaction while the value is available; and assumes transformed disclosure is
still possible.

### 3. Explicit degraded mode

If neither strategy is reliable, the worker still runs and Agent Monitor may
show repository-scoped activity with:

```text
binding: unattributed
reason: unsupported | hooks-disabled | project-untrusted | pending |
        expired | identity-mismatch | ambiguous
```

There is no mid-run recovery unless the host later learns the exact session and
uses direct binding. Reissuing a token to an already-running process is not
claimed to work.

## Migration Without an Attribution Gap

Do not delete the only currently working path before its replacement is
proven.

1. Add direct binding and optional handoff alongside the existing heuristic.
2. Mark a context `external-binding-pending` before provider launch. The old
   claim-command heuristic must ignore that context, preventing it from binding
   the orchestrator first.
3. Prove direct/fallback binding in the deterministic end-to-end matrix.
4. Remove automatic claim-command binding at the release gate.
5. If same-session execution remains useful, reintroduce it only through an
   explicit `--executor current-session` mode that is mutually exclusive with
   external binding.

## Authority and Runtime Invariants

- Bindings and hooks write ignored, bounded observation state only. They never
  write the Run journal, claims, lifecycle state, registry, outcomes, edges, or
  gates.
- Raw session IDs and fallback tokens never enter published Loop or Oven data.
- Provider payloads are bounded and normalized before shared Loop code.
- Repository containment and one live Run/node/attempt are required.
- No matching by newest transcript, timestamp proximity, PID, process order,
  singleton claim, or repository exclusivity.
- Hook failures are quiet and fail open with respect to provider execution.
- Hook output is behaviorally neutral: it never approves, denies, rewrites, or
  forces a permission prompt. If a neutral pre-tool response is unavailable,
  use a passive lifecycle/invocation/post-tool hook.
- The synchronous hook path never waits indefinitely for the repository state
  lock and never performs transcript scans or Run-store walks while holding
  that lock. Lock contention returns a neutral no-op.
- Hook latency has an explicit tested budget derived from provider hook
  timeouts measured in B1.
- Zero runtime dependencies, Node 18 compatibility, atomic writes, symlink
  containment, and the 400-line new-file limit remain mandatory.

## Ordered Implementation

### B1 — Decide the binding strategy per provider

Files/search:
installed provider help/docs, sanitized launch/hook fixtures,
`agent-monitor-sources.mjs`, `hook-context.mjs`, and provider setup references.

For each provider, prove in this order:

1. Can the host set a new session identity before launch?
2. If not, can it read the identity from structured stdout, a stable launch
   API, or a deterministic local record before meaningful work?
3. Does the hook process inherit the exact launch environment?
4. What is the earliest parent-session event, and can a subagent precede it?
5. What hook stdout is behaviorally neutral?
6. Does hook identity exactly equal Agent Monitor transcript identity?
7. What are project-trust behavior and measured startup-to-first-hook latency?

Produce a checked-in capability matrix selecting exactly one strategy:
`direct-set`, `direct-learn`, `token-fallback`, or `unattributed`.

Live status: the first seven checks are complete for Codex, Claude, and Grok.
Antigravity has exact identity, environment, trust, workspace, neutral passive
hook, and latency evidence; only the parent/subagent race check remains before
selecting `token-fallback`.
Done when:
no runtime/token/config design depends on an unverified provider behavior.
Validate:
sanitized fixtures plus opt-in isolated live probes. Paid/network launches are
manual evidence, never default CI.

### B2 — Add provider-neutral direct binding

Files/search:
Loop controller/host-task surfaces, a small observation-binding module,
hook-context storage, CLI parsing/help, and focused tests.
Action:

- Add `loop observe bind` as a host-only observational command.
- Validate exact active Run/node/attempt/repository/provider before writing.
- Hash the provider/session identity immediately; persist no raw identity.
- Make retries idempotent and conflicting second identities fail closed.
- Keep the binding unrepresentable in semantic result/submit contracts.
- Add `external-binding-pending` fencing for the migration heuristic.
Done when:
two honest concurrent workers bind to their own nodes without hooks consuming a
secret, and malicious observation fields cannot mutate Run state.
Validate:
concurrency, replay, wrong provider/repository, attempt drift, expired claim,
conflicting session, crash-cut, and semantic-boundary tests.

### B3 — Make the hook path bounded and provider-canonical

Files/search:
`loop-hook-cli.mjs`, `hook-context.mjs`, `hook-observation.mjs`, and new small
provider adapter modules.
Action:

- Define one bounded canonical event shape.
- Implement pure Codex, Claude, Grok, and Antigravity adapters.
- Normalize Grok `sessionId`, lower-snake events, `toolUseId`,
  `run_terminal_command`, and `toolInput.command`.
- Normalize Antigravity `conversationId`, explicit configured event,
  `workspacePaths`, `stepIdx`, `run_command`, and
  `toolCall.args.CommandLine`.
- Reject ambiguous Antigravity workspaces and configured/raw event mismatch.
- Replace blocking lock behavior with timeout-and-skip or an equivalent
  non-blocking observation path. Do not read the Run store inside a contended
  hook lock.
- Record hook duration in tests and enforce the B1-derived budget.
Done when:
malformed, slow, contended, or unsupported input produces a prompt-neutral
no-op and existing Codex/Claude fixtures remain green.
Validate:
adapter, hostile-input, path-containment, idempotent-cursor, lock-contention,
latency, and Run-state-unchanged tests.

### B4 — Admit a token fallback only where B1 requires it
Action:

- Skip this item entirely if every target provider supports direct binding.
- Add a versioned, digested, one-use handoff record only for eligible provider
  rows.
- Derive expiry and trust preflight from measured B1 evidence.
- Consume at the earliest proven parent event.
- Redact the exact raw value until consumption; document that encoding or
  deliberate exfiltration remains possible.
- Surface pending, expired, untrusted, raced, and unattributed states.
- Preserve direct late binding as the only recovery for a running process.
Done when:
the fallback isolates honest concurrent workers without being described as
authentication or audit evidence.
Validate:
environment inheritance, parent/subagent race, replay, expiry, slow startup,
trust delay, attempt drift, wrong provider/repository, and disclosure tests.

### B5 — Ship a Codex/Claude correlation slice
Action:

- Integrate the B1-selected direct/fallback strategies for the two existing
  hook providers.
- Keep current hook install/uninstall behavior byte-compatible.
- Run deterministic prepare → launch identity → bind → activity → submit flows.
- Only after the replacement matrix passes, remove the automatic
  claim-command heuristic at the release gate.
Done when:
existing users retain attribution without an intermediate broken release and
externally launched Codex/Claude workers bind correctly.
Validate:
existing hook transaction tests, E2E maker/reviewer/failure/retry tests, fast
verification, then the full release gate.

### B6 — Add opt-in Grok and Antigravity observation

Files/search:
provider-specific hook config codecs, hook CLI/status, activity projection,
dashboard types/Loop graph, Agent Monitor producer, and terminal projection.
Action:

- Grok: own `.grok/hooks/burnlist.json`; report project trust separately.
- Antigravity: own one exact named entry in `.agents/hooks.json`; preserve its
  distinct top-level hook grammar.
- Launch Antigravity headlessly with explicit `--add-dir <repo>`; otherwise it
  exposes no workspace and does not load the project hook in the tested CLI.
- Detect `GROK_SESSION_ID`/Grok camelCase payloads on Claude-compatible hooks,
  return a neutral no-op there, and dedupe the native Grok observation.
- Require explicit `--agent grok`, `--agent agy`, or a named list initially.
- Install Loop observation only. Do not imply Streaming Diff support.
- Preflight every selected config before writing; use atomic multi-file
  rollback and exact ownership removal.
- Extend provider unions and show cooperative binding state consistently in web
  and terminal views.
Done when:
install/status/uninstall are symmetric, foreign config is preserved, and both
providers pass the exact identity-to-transcript proof or degrade visibly to
unattributed.
Validate:
config ownership, malformed/partial config, tracked/untracked, symlink,
rollback-cut, project-trust, provider identity, and paired web/TUI tests.

### B7 — Simplify orchestration and documentation

Files/search:
host task presentation, Burnlist skill, host execution, Agent Monitor,
installation, provider setup, README, and CLI help.
Action:

- Keep the skill and semantic commands with the orchestrator.
- Give workers only task prompts; explain that passive hook helpers may execute.
- Pass host-selected identities or fallback launch metadata outside prompts.
- Label all attribution cooperative and observational.
- Explain unattributed reasons, trust preflight, expiry, attempt drift, and the
  limited direct-binding recovery.
- Keep Streaming Diff Codex/Claude-only.
Done when:
documentation cannot be read as claiming audit, read-only, proof, or semantic
authority from Monitor data.
Validate:
prompt snapshots reject skills, lifecycle commands, tokens, claims, graph
mechanics, telemetry instructions, and provider nicknames; documentation
commands pass.

### B8 — Final matrix and release gate
Action:

- Exercise direct and admitted fallback strategies with deterministic fake
  provider processes.
- Cover maker, read-only reviewer, failure, retry, concurrent branches,
  subagents, lock contention, slow startup, trust failure, and attempt drift.
- Verify no raw identity/token reaches prompts, canonical journals, events, or
  snapshots through ordinary capture. Explicitly retain deliberate transformed
  exfiltration as a non-goal.
- Add every new test to the fast verification manifest.
- Run focused tests during development and `npm run verify` once as the release
  gate.
Done when:
each provider has a proven strategy or an honest unattributed state, hook
latency is bounded, automatic heuristic binding is gone, and full verification
passes.

## Acceptance Matrix

Every provider row records:

- strategy: direct-set, direct-learn, token-fallback, or unattributed;
- identity source and transcript-identity equality;
- cooperative label;
- exact repository and live Run/node/attempt;
- concurrent-worker isolation;
- parent/subagent behavior;
- trust and startup behavior;
- hook neutrality and latency budget;
- install/status/uninstall ownership;
- web and terminal rendering;
- no semantic Run mutation from observations;
- explicit degraded reason and recovery, if any.

## Non-Goals

- Forensic identity, tamper resistance, or proof that a worker was read-only.
- Semantic outcomes, graph transitions, gates, or completion from Monitor data.
- Worker installation or use of the Burnlist skill.
- Matching Grok/Antigravity Streaming Diff support.
- A Burnlist-owned provider daemon or universal launcher.
- Preventing a worker from disabling hooks or deliberately disclosing,
  transforming, or fabricating observation data.
- Inferring identity from timing, newest files, process ordering, or singleton
  state.
- Runtime dependencies or executable Oven definitions.

## Settled Review Decisions

- Direct host-side session binding is preferred; token handoff is fallback
  only.
- Grok and Antigravity hook installation is opt-in initially.
- Repository-scoped unattributed activity is an acceptable degraded mode when
  its reason is visible.
- Streaming Diff remains Codex/Claude-only until separately proven.
- Codex/Claude replacement ships and proves migration before Grok/Antigravity
  expand the hook surface.
