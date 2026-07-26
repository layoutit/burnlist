---
name: burnlist-loop
description: >-
  Execute a hardened repo-local Burnlist as a DAG-scheduled, role-separated multi-agent loop. The coordinator walks the dependency graph, and each ready item moves through direction, sole-writer implementation, parallel read-only verification, fresh final review, and completion. Model families are scheduler configuration, never worker identities. Concurrent item loops run in git worktrees, one per repository per item, and are co-scheduled only when their write scopes are disjoint. Use when running or implementing a Burnlist with subagents, delegating implementation slices, or coordinating parallel waves. Pair with the `burnlist` execution skill and `burnlist-create` planning skill.
---

# Burnlist Loop

A deterministic orchestration for turning a hardened Burnlist into merged, verified work. The coordinator never writes product code itself: it schedules, freezes packets, adjudicates, and burns. Delegate implementation and verification to workers with concrete task roles.

Read the companion skills first: `burnlist` owns the queue/burn-transaction protocol; `burnlist-create` owns plan hardening. This skill owns the *execution loop* on top of them.

## Roles

| Role | Responsibility | Writes? |
|------|----------------|---------|
| **Coordinator** | Owns the Burnlist, computes the ready set, locks write scope, freezes packets, adjudicates accept/reject, burns items, and serializes all parent-Burnlist edits. | Burnlist + worktree merges only |
| **Direction reviewer** | Inspects source and prerequisite evidence, applies design judgment, and produces a technical packet plus acceptance matrix. | No (read-only) |
| **Implementation worker** | Implements the frozen packet as the item's **sole writer**. | Yes (its worktrees) |
| **Verification reviewer** | Runs one read-only verification lane: contract/conformance, resilience/security, performance/resources, visual/interaction, or integration/regression. | No (read-only) |
| **Final reviewer** | Independently checks the completed diff in a fresh context after every required verification lane passes. | No (read-only) |

Role names describe responsibilities. Model names select execution backends. Never
turn a model family or tier into a worker identity: do not prompt “You are Luna,”
“You are Sol,” or “You are Terra.” Prompt “Act as the implementation worker,”
“Act as the direction reviewer,” or “Act as the verification reviewer,” then
state the item, write authority, path scope, inputs, and required output.

## Custom Loop composition

Treat node identity, execution semantics, and review policy as separate layers:

- Let the author choose each lowercase-slug node ID, such as
  `train-model`, `adversarial-review`, or `release-gate`.
- Use an `agent` with `mode="task"`, `role="maker"`, and `authority="write"`
  for a writing task; use `mode="review"`, `role="reviewer"`, and
  `authority="read"` for an independent review.
- Put the exact behavior in that node's `instructions.md` section. An
  `adversarial-review` section can actively seek counterexamples; a
  `p0-p1-review` section can reject only for open P0/P1 findings and record
  lower-priority findings without blocking.
- Use a `check` for one trusted deterministic repository capability.
- Use the convergence `gate` to require the chosen check/review evidence. The
  gate consumes outcomes; it does not invent a review policy. Severity rules
  belong in the reviewer instructions that produce approve/reject/escalate.
- Compose control flow with edges and bounded back edges. Model/provider
  selection remains host policy derived from route and intelligence hints.

The host task must preserve the custom node's instructions and structural
authority while describing the worker only by its responsibility. Custom node
names must never become hardcoded model identities.

### Backends: pick by domain strength, not one linear tier (default)

Models aren't ranked on a single axis — a model can lead one benchmark and
trail another. Bucket by what the role actually needs, not overall vibes.
Sources (Jul 2026): SWE-bench Verified/Pro (code-fix correctness),
Terminal-Bench 2.1 (end-to-end agentic/tool-use), Snorkel GDPVal+ (real
professional-task judgment), Artificial Analysis reasoning index.

| Domain | Leader | Runner-up | Notes |
|--------|--------|-----------|-------|
| Raw reasoning | `gpt-5.6-sol` (92) | `fable` | direction and final review |
| Code-fix correctness (SWE-bench) | `opus` (88.6-96%) | `gpt-5.6-terra` | implementation or verification |
| Agentic/terminal execution | `gpt-5.6-luna`/Codex (83.4%) | `fable` (83.1%) | shell-heavy implementation |
| Real-world professional judgment | `grok-4.5` (GDPVal+ 29% vs Opus 21%) | `gpt-5.5` (22%) | professional-acceptance verification |
| Cheap bulk reads | `haiku`, `gemini-*-flash-low`, `gpt-oss-120b` | — | long-file digestion, log triage — not implement/verify |
| Weaker fit here | `gemini-3.1-pro` (70.7% terminal-bench) | — | keep in rotation for diversity, not as primary driver |

Default role-to-domain mapping: use raw reasoning for direction and final
review, agentic execution or code-fix strength for implementation, and
code-fix plus real-world judgment for parallel verification lanes. Different
lanes should target different failure classes rather than repeat one check.

`agy models` / `grok models` enumerate what's actually installed — re-run
before picking; `grok` needs `grok auth login` to see its full roster.
Benchmarks move fast and providers change — treat this table as directional
and re-verify scores before trusting it for a high-stakes item.

## Outer DAG loop (coordinator)

```
Read Burnlist
  -> compute ready set (items whose deps are all in Completed)
  -> select safe parallel candidates (ready, disjoint write scopes, distinct lanes)
  -> run one item loop per candidate (concurrently, in worktrees)
  -> coordinator burns accepted items (writes IDs to Completed)
  -> viewer/dashboard recomputes ready set   (burning unlocks downstream)
  -> repeat until queue empty
```

Dependencies come from `goal.md` ordering + each item's declared deps. The Burnlist dashboard (`burnlist` skill's server) recomputes the ready set from the Completed ledger; burning an item immediately unlocks its downstream items.

## Inner item loop (per ready item)

```
Coordinator selects item + locks ownership/write scope (set of (repo, paths))
  -> DIRECTION REVIEW: inspect source + prereq evidence; standard or deep-design
     judgment; specify what/how/why; produce technical packet + acceptance matrix
  -> Coordinator freezes packet
  -> IMPLEMENTATION WORKER writes (sole writer, in the item's worktree(s))
  -> VERIFICATION REVIEWERS run lanes (read-only, parallel):
       contract/conformance | resilience/security | performance/resources
       | visual/interaction | integration/regression
  -> Any required lane fails?
       YES -> defects to implementation worker -> implement again (loop)
       NO  -> continue
  -> FRESH FINAL REVIEW (separate context from direction review):
       independent subaudits where required; rerun the authoritative proof;
       check goal, packet, diff, and boundaries
  -> ACCEPT?
       NO, implementation defect -> implementation worker (loop)
       NO, packet/scope defect   -> coordinator + direction reviewer redesign or split
       YES -> coordinator burns item (merge worktrees, write ID to Completed)
```

## Rules (invariants)

- **All required verification lanes must pass. No majority vote.**
- **Direction review and final review use separate contexts** (never reuse the direction context for final verification).
- **The same defect twice, any scope expansion, or ownership overlap returns to the coordinator and direction reviewer** for redesign or split, not another blind implementation retry.
- **Parallel item-loops require disjoint write scopes.** Co-schedule only ready items whose (repo, path) write sets do not overlap.
- **One coordinator serializes edits to the parent Burnlist.** Never let two loops mutate `burnlist.md` concurrently.
- **Shared goldens/build outputs and physical-device access remain serialized**, even across otherwise-disjoint items.
- **Burning places the ID in Completed**, which immediately unlocks downstream items in the viewer.
- **The implementation worker is the only writer inside an item loop.** Every reviewer is strictly read-only.

## Multi-repo write isolation (this ecosystem is 5 independent repos)

Repos (each its own git repo, own `main`; root excludes `/ecosystem/`):
`.` (spawnfile) · `ecosystem/simfile` · `ecosystem/moltnet` · `ecosystem/mneme` · `ecosystem/daimon`.

An item's write scope is a set of **(repo, paths)** tuples. A single item often spans repos (e.g. a memory item writes `ecosystem/mneme/src` AND root `src/runtime/...`). Therefore:

- **One git worktree PER REPO PER ITEM.** An item touching N repos gets N worktrees. The Agent tool's built-in `isolation: "worktree"` only isolates the *current* repo, so cross-repo items must have their worktrees created manually by the coordinator.
- Create outside the tracked trees, on a per-item branch:
  ```sh
  # for each repo R the item writes to:
  git -C <R> worktree add /tmp/noopolis-worktrees/<item-id>/<repo-name> -b loop/<item-id>
  ```
  The implementation worker edits only inside these worktrees; verification and final reviewers read them (pass the worktree paths as the review target).
- **Merge-back on accept:** the coordinator applies each worktree's diff to that repo's `main` (fast-forward/merge or `git -C <R> merge loop/<item-id>`), then `git -C <R> worktree remove ...`. Per the `burnlist` skill, do not commit/push beyond what the user authorized; keep merges local unless told otherwise.
- **Disjointness is per-repo:** two ready items may run in parallel only if, within every shared repo, their path sets do not overlap (else the merge-back conflicts). Items in entirely different repos are trivially disjoint and ideal parallel candidates.
- Declare each item's write scope in its plan (`plans/<id>.md`) as a `Writes:` line listing `(repo: paths)` so the coordinator can compute safe parallel sets mechanically.

## Invocation reference

### Codex backend (`codex exec`)
Grounded for codex-cli 0.144.0. Models: `gpt-5.6-sol|terra|luna` (372k ctx). Default effort in `~/.codex/config.toml` is `ultra` (slow; lower with `-c model_reasoning_effort=<tier>` for cheap slices).

```sh
# Direction reviewer (read-only, produce packet)
codex exec -m gpt-5.6-sol -s read-only -C <repo> -o packet.md "<direction prompt: read X, specify what/how/why + acceptance matrix>"

# Implementation worker (sole writer, workspace-write, in the item worktree)
codex exec -m gpt-5.6-luna -s workspace-write -C <worktree> -o result.md "<frozen packet>; implement; do not commit; return a change summary"

# Implementation fix round (continue same session)
codex exec resume --last -o fix.md "<verification defects>"

# Verification reviewer (read-only, one call per lane, run in parallel)
codex exec -m gpt-5.6-terra -s read-only -C <worktree> -o lane-contract.md "<contract/conformance checks against the acceptance matrix>"

# Final reviewer (NEW exec, not resume — separate context)
codex exec -m gpt-5.6-sol -s read-only -C <worktree> -o verdict.md "<verify diff against goal, packet, boundaries; rerun the authoritative proof; ACCEPT/REJECT + reasons>"
```

**Gotchas (learned):**
- `codex exec resume` does NOT accept `-s` or `-C`; it inherits cwd + sandbox from the resumed session. Pass only `[SESSION_ID] [PROMPT]`, `--last`, `-m`, `-o`, `-c`.
- `--last` is cwd-filtered; run resume from the same cwd as the original session (or pass an explicit session id).
- Capture the final message with `-o <file>`; stream events with `--json`; force a structured verdict with `--output-schema <file>`.
- Long prompts: pass via `"$(cat prompt.txt)"` or `-` (stdin). High-effort review runs take minutes — launch as a background command and poll for the `-o` file rather than blocking a foreground call.
- Sandbox: `read-only` for reviewers, `workspace-write` for the implementation worker. Use `--dangerously-bypass-approvals-and-sandbox` only inside an already-sandboxed environment.

### Claude backend (Agent tool)
Spawn subagents with a `model` override (`fable` | `sonnet` | `opus`). For an implementation worker on the current repo, use `isolation: "worktree"`; for cross-repo items the coordinator creates worktrees manually (see above) and points the agent at those paths. Give reviewers read-only agent types or read-only instructions; run independent verification lanes concurrently.

## Mapping to the Noopolis burn

- 5 repos as above; B1–B24 already burned.
- Per the design review (`sol-review.md`), the re-sequenced plan is foundational-serial then gated: `B57 (causal envelope) -> B58 (world.act + scored task) -> B59 (Mneme state machine) -> B60 (acceptance profiles) -> B0 (live falsification gate)`. These are mostly serial (shared contracts) so run one loop at a time.
- After B0 passes, the first real **parallel wave** is naturally repo-disjoint, e.g. `B26` (ecosystem/mneme + root), `B29` (root src/runtime), `B42` (ecosystem/simfile) — different repos = clean parallel candidates, each getting its own full direction → implementation ↔ verification → final-review → completion loop.
- The coordinator computes the ready set from `goal.md` deps + Completed; declare per-item `Writes:` scopes in `plans/<id>.md` to make safe-parallel selection mechanical.
