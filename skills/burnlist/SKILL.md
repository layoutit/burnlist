---
name: burnlist
description: >-
  Create, harden, execute, coordinate, maintain, and repair repo-local Burnlists: turn goals into strict shrinking checklists, run active items with atomic completion, split or reorder work, coordinate independent worker tasks and queues, monitor generic Oven progress events, manage lifecycle folders and terse completed ledgers, and repair the local dashboard/tracker. Use for planning, execution, multi-Burnlist coordination, or live worker supervision.
---

# Burnlist

Use one skill for the full Burnlist lifecycle. Burnlist is task state, not implementation strategy; let the repo or domain skill own code, tests, browser or oracle evidence, performance rules, deploy rules, and PR packaging.

> **Start here:** Read `references/getting-started.md` first if Burnlist is new to you. It explains what Burnlist is, the three concepts, and installation and setup.

## Choose A Mode

- **Repository setup mode:** when the user says “set up Burnlist in this repo,” “initialize Burnlist here,” or equivalent, read `references/getting-started.md`, run `burnlist init` in the current repository, confirm that the root is registered, briefly explain that a Burnlist is an evidence-backed shrinking work list, and ask one direct question: “What do you want to burn?” Do not make the user choose commands, folders, Ovens, Loops, or server settings before they have described the goal. Once they answer, switch to creation mode.
- **Creation mode:** when creating, hardening, restructuring, or readying a Burnlist, read `references/burnlist-creation.md` completely before editing Burnlist files. Creation owns `draft -> ready` and does not implement the planned work unless the user also asks to continue into execution.
- **Execution mode:** when implementing or continuing a ready/in-progress Burnlist, follow the execution path below. Keep the hot working set small: the active item, relevant `goal.md` guardrails, current implementation evidence, and the state mutation being performed.
- **Coordination mode:** when selecting independent Burnlists, opening worker tasks, monitoring active workers, or assigning the next queue, read `references/oven-event-coordination.md` completely before acting. Retain exact task handles and use canonical Burnlist state plus Oven events; do not use model heartbeats as a status loop.
- **Combined request:** finish and validate creation first, park the folder in `ready/`, then switch explicitly to execution mode and move the whole folder to `inprogress/`.

## Cold References

Read references only when their trigger applies:

- `references/getting-started.md`: new-agent onboarding: what Burnlist is, the three concepts, and installation and setup.
- `references/burnlist-creation.md`: mandatory for creation, hardening, draft repair, and `draft -> ready` work.
- `references/burnlist-protocol.md`: lifecycle moves, required file shapes, `goal.md`, `completed.md`, scratch, legacy migration, closeout, local artifacts.
- `references/burnlist-splitting-lanes.md`: split/reorder decisions, recursive gates, parent/lane Burnlists, parallel lane handoff.
- `references/burnlist-visible-output.md`: detailed silence rules, forbidden narration examples, checkpoint policy.
- `references/burnlist-dashboard.md`: dashboard/chart/log/timeline/repo-graph behavior or dashboard repair only.
- `references/installation.md`: installing or removing the agent skill or Streaming Diff edit-capture hooks.
- `references/designing-ovens.md`: choosing what an Oven should measure through proxy-resistant evidence, before touching the DSL.
- `references/oven-authoring.md`: authoring or inspecting Ovens from the `burnlist oven` CLI, the widget/format vocabulary, and source-binding conventions.
- `references/creating-ovens.md`: authoring a new .oven declarative source (grammar, elements, binding, themes, compile-to-IR walkthrough).
- `references/oven-event-coordination.md`: mandatory for multi-Burnlist worker coordination, generic Oven progress events, replayable subscriptions, and event-triggered coordinator wakeups.
- `references/host-execution.md`: generic host next/execute/submit protocol for a prepared Loop Run; read before a host executes an agent node.
- `references/operational-ux.md`: optional per-item recommendations, coarse-to-fine defaults, P0-P4 review handling, truthful live states, provenance, and task-fit Oven visual proof.
- `references/loop-capability-example.json`: starting catalog only when a repository has no trusted check capability yet. Its two top-level keys are inputs to *different* commands — `catalog` is the flat body of `.burnlist/loop-capabilities.json`, `grants` is the `--grants` file for `loop capability trust`. Copying the file verbatim to either location fails; see `references/host-execution.md`.
- `references/loop-provider-setup.md`: mandatory before the first Loop when available native agents, CLIs, logins, or subscriptions are unknown; inventory safely, show the user, and ask what to enable.
- `references/loop-providers/<provider>.md`: bounded invocation recipe for Claude native, Codex native, Codex CLI, AGY, Grok, or a custom host. Read the selected provider recipe before invoking it.
- `references/agent-monitor.md`: automatic Agent Monitor lifecycle, worker-skill simplification, and Loop session attribution boundaries.

Do not load cold references for a normal single-item implementation unless needed. If a task touches a cold-rule area, read the matching reference before editing Burnlist state in that area.

## Canonical Files

Execution-ready Burnlists live in:

```text
notes/burnlists/ready/<YYMMDD-NNN>/burnlist.md
```

Execution moves the whole folder to:

```text
notes/burnlists/inprogress/<YYMMDD-NNN>/
```

Closeout moves it to:

```text
notes/burnlists/completed/<YYMMDD-NNN>/
```

Do not execute from `draft/<id>/`. If the user names a draft, switch to creation mode and read `references/burnlist-creation.md`, or ask for an explicit readying step.

`burnlist.md` is hot shrinking state:

- metadata
- `## Active Checklist`
- terse `## Completed` ledger

`goal.md` is the stable contract. Read it before moving `ready` to `inprogress`, before burning the first item of an active Burnlist, after compaction only when the stable contract is unclear, and whenever scope/proof authority is unclear. Do not reread it before every routine step.

`completed.md` is optional durable history for humans. It is not canonical dashboard progress. Missing historical entries must not block progress or `--check`.

## Normal Execution Path

1. Confirm the Burnlist folder is in `inprogress/<id>/`; if it is in `ready/<id>/`, move the whole folder first.
2. Read the current top active item and the relevant `goal.md` guardrails.
3. Implement and validate the active item with repo-appropriate proof.
4. If the item is too broad, split or reorder explicitly before continuing. Read `references/burnlist-splitting-lanes.md` first.
5. If validation passes, burn the item atomically:
   - generate a local ISO timestamp mechanically, preferably:
     ```sh
     burnlist --stamp
     ```
   - append one terse completed ledger line:
     ```markdown
     - <id> | <YYYY-MM-DDTHH:mm:ss±HH:mm> | <short item title>
     ```
   - delete the active item
   - append/update one compact `completed.md` record when useful
   - run the protocol check
6. If active checklist is empty, close out: digest if needed, check, then move the folder to `completed/<id>/`. Read `references/burnlist-protocol.md` for closeout details.

Run the protocol check with:

```sh
burnlist --plan notes/burnlists/inprogress/<YYMMDD-NNN>/burnlist.md --check
```

Fix only protocol errors reported by the checker unless the user asks for broader hardening.

## Execution Invariants

- Work from the top active item unless the user explicitly selected another item.
- Active checklist order is canonical; numeric ids are stable labels, not execution order after splits/reorders.
- `Pending` is dashboard-computed. Never write or treat it as an agent decision to skip work.
- Do not silently remove future active items. Future-item deletion must be an explicit split/reorder/contract repair.
- Do not casually rewrite `goal.md` during execution. If the contract is wrong, move back to `draft/` and switch to creation mode.
- Do not add stable contract sections, archived items, changelogs, test logs, progress metadata, dashboard state, or telemetry to `burnlist.md`.
- Keep Burnlist artifacts local unless the user explicitly asks to stage or commit them.
- Do not stage, commit, push, deploy, clean, or rewrite unrelated files unless explicitly asked.

## Visible Output Boundary

Do not reduce reasoning depth; reduce visible narration. Use internal reasoning, tools, tests, and the dashboard as working-state channels. Visible chat is for user decisions, blockers, real scope changes, split decisions, completed atomic results, and final handoff.

During a normal burn transaction, stay silent from the moment validation passes until the transaction completes, fails, or exposes a real blocker/split/scope decision. Do not narrate ledger edits, timestamp generation, `completed.md` writes, active-list updates, or protocol-check starts.

After compaction or context refresh, do not summarize skill instructions back to the user unless explicitly asked. Refresh missing guidance silently, then continue from the active item.

For detailed examples and banned narration, read `references/burnlist-visible-output.md`.

## Dashboard Boundary

The live dashboard is mandatory as an observer, but agents do not manually manage its server lifecycle. A global Burnlist installation owns one persistent shared loopback service for registered repositories; `burnlist` and `burnlist -i` ensure it is healthy. A local installation owns an ephemeral loopback service only for `burnlist -i` and stops it when the TUI exits. Do not start a per-plan server, manage ports, claim an unverified dashboard URL, or inspect dashboard UI unless the user asks or dashboard behavior is the task. Use `burnlist service status` only when lifecycle diagnosis is relevant; preserve `--server` as an explicit user-selected override. Adopting a shipped, pinned, read-only observer Oven is safe and needs no separate permission; it does not authorize dashboard UI inspection.

The dashboard scans lifecycle folders and is read-only. `burnlist.md` and lifecycle folder location are canonical task state. Dashboard charts/logs/repo graphs are observer evidence, not implementation proof.

### Project registry

The dashboard observes burnlists across a machine-local registry of repo roots (`~/.burnlist/roots.json`) unioned with the current repo, so one dashboard can cover every registered project. Registration is **always explicit** — the CLI is the only writer and nothing auto-registers:

- `burnlist init [path]` — for a **new** repo: scaffold `notes/burnlists/{draft,ready,inprogress,completed}/`, git-ignore that state locally (via `.git/info/exclude`; `--track` commits it with `.gitkeep`s instead), and register the root.
- `burnlist register [path]` — for an **existing** repo that already has burnlists: register only (no scaffolding, no ignore change).
- `burnlist unregister [path]` — remove a repo root.
- `burnlist roots [--prune]` — list registered roots with health (`healthy`/`empty`/`missing`/`unreadable`); `--prune` drops only missing ones.

A burnlist in an unregistered repo is still visible when the dashboard is launched inside it, but not in the global landing until `init`/`register`. Hint the user to register; never auto-register. Observation spans all registered repos, but mutating verbs (`--close-completed`, lifecycle moves) act only on the current repo.

`New Oven` and `Run Burn` are explicit user-controlled local controller surfaces. For Oven contract, UI, validation, or Run-snapshot work, read `references/oven-contract.md`. Preserve its two-file declarative package and ownership boundary: custom Ovens may be created under ignored `.local/burnlist/ovens/` state and snapshotted under `.local/burnlist/runs/`, but neither surface may execute instructions, produce project data, own canonical project state, mutate Burnlists, import arbitrary UI code, or start an agent.

Ovens can also be authored and inspected from the CLI: `burnlist oven <list|view|use|set|bind|unbind|bindings|adopt|upgrade|create|update|fork>`. `use` adopts a shipped Oven and installs only an existing validated example; `set` validates supplied JSON before atomically publishing ignored canonical data and its binding. Built-ins use the render handler's runtime validator, while custom Ovens without one warn that pointer validation is `shape-only`, not truth validation. The CLI writes custom Ovens or committed vendored copies, keeps shipped built-in Ovens read-only, and never executes instructions. Ovens carry an `id@version` identity and can be vendored and pinned per project with `adopt` and opt-in `upgrade`. `burnlist oven view <id>` renders the detail skeleton as a box-drawing grid for quick inspection. Read `references/oven-authoring.md` for exact `use`/`set` failure semantics, widget vocabulary, and source-binding conventions.

Oven progress events are a separate observational surface under ignored repo-local state. They never replace Burnlist files or an Oven's proof artifacts. Checklist burns and Differential Testing worker iterations publish them automatically; future adapters use the same package API or `burnlist oven event`. The dashboard exposes one replayable `/api/events` feed across Ovens and repos. Read `references/oven-event-coordination.md` before using events to supervise worker tasks or wake a coordinator.

Do not embed repo/domain dashboards inside the Burnlist dashboard. Domain-specific viewers must live in their repo-local tools and may be linked or launched separately. Share state only through Burnlist lifecycle files, explicit URLs, or a narrow message contract; do not share CSS, layout code, routes, or polling loops.

Read `references/burnlist-dashboard.md` only for dashboard/chart/log/timeline/repo-graph questions or dashboard repair.

## Agent Installation Systems

Burnlist has two independent installable systems. Either or both may be present:

- **Skill discovery** (`burnlist install`) makes this Burnlist skill discoverable to both agents. The default is a per-repository, untracked-local registration in `<repo>/.claude/skills/burnlist` for Claude Code and `<repo>/.agents/skills/burnlist` for Codex. `--global` instead uses `~/.claude/skills/burnlist` and `~/.agents/skills/burnlist`; a global npm installation automatically registers both skills and starts the shared observer service. Use `--commit` only for a per-repository portable copy intended for Git; `--agent codex,claude` limits targets and `--dry-run` previews. `burnlist uninstall` is the inverse; `burnlist uninstall --global --purge` also removes the global npm package.
- **Native observability hooks** (`burnlist hooks install`) install per-repository edit-capture and advisory Loop-observation commands, not skills. Codex consumes `<repo>/.codex/hooks.json`; Claude Code consumes `<repo>/.claude/settings.json`. They invoke `burnlist streaming-diff hook` around edits and `burnlist hooks observe` for supported native lifecycle events, merging with existing entries. Observations are bounded local facts and never semantic Loop outcomes. Hooks have no global mode: use `burnlist hooks uninstall` or `burnlist hooks status` in the repository, optionally with `--agent codex,claude`. `--untracked` asks install to add the config to `.git/info/exclude`; it cannot hide an already tracked config.
- **Run retention** keeps operational reads bounded without a global history cap. `burnlist loop list` returns the newest bounded window; item hazards validate every relevant Run and fail closed on relevant corruption. `burnlist loop prune --retain <count>` explicitly archives only safely terminal, non-current Runs and never deletes active/converged authority.

Install only the system the task needs, or both. Read `references/installation.md` for exact commands, ownership, and shared-versus-local behavior.

## Built-in Loops (Stage 1)

Honor the choice already assigned by the user or active item:

- no assignment: implement directly and use ordinary `burnlist burn`
- `loop:builtin:gate`: maker, trusted repository check, Burn
- `loop:builtin:review`: maker, trusted check, independent reviewer, Burn
- `loop:builtin:branch`: plan, host-selected slices, merge, trusted check,
  independent reviewer, Burn

Do not substitute a different Loop because it is more convenient. Read
`references/host-execution.md` for the core CLI protocol; it is intentionally
not duplicated here.

### Running an assigned Loop is mandatory

**If an active item carries a Loop assignment, you MUST execute it.** An
assigned Loop is the item's declared proof path, not a suggestion.

```sh
burnlist loop create item:<burnlist-id>#<item-id>   # note the `item:` prefix
burnlist loop next run:<id>                         # claims node, returns the worker prompt
burnlist loop submit run:<id> --outcome complete    # or approve / reject / escalate
```

`burnlist burn` refuses an item that carries Loop metadata
(`direct burn is blocked by Loop metadata`). That refusal means *run the
Loop*, not *remove the Loop*.

**`burnlist loop unassign` is not an escape hatch.** Unassigning an item that
has no terminal Run, then burning it directly, silently converts declared
multi-agent work into unverified solo work and defeats the assignment. Doing
so is a **scope change that requires explicit user approval** — state plainly
that the item was assigned `<loop>`, that you intend to burn it without
running that Loop, and why, then wait. Never unassign merely because the
direct path is faster or because the Loop protocol is unfamiliar; if the CLI
grammar is unclear, read `references/host-execution.md` rather than routing
around it.

Legitimate reasons to unassign are narrow: the user asks for it, the Loop's
trusted-check capability provably cannot exist yet (e.g. the repo has nothing
for `repo-verify` to run), or the item's scope changed enough to need a
different Loop. Record which one applied.

The orchestrating host—not Burnlist and never the worker—owns provider setup
and supervision. It inventories providers without reading credentials, asks
the user what to enable, hands interactive login or trust consent to the user,
runs authorized Burnlist-supported hook setup, allocates launch-only session
metadata, supplies the exact repository/permissions/model flags, keeps the
process supervised, validates its result, and submits the Loop outcome. If
provider availability is unknown, read `references/loop-provider-setup.md`;
then read only the selected provider recipe. Give workers only the prepared
task prompt: workers do not configure providers or hooks, manage trust, receive
skills, run Burnlist lifecycle commands, hold claim identities, or know graph
mechanics.

Make semantic decisions only from evidence:

- submit `complete` after the maker has implemented and checked its work
- submit `approve` only from a fresh independent read-only review with no open blocker
- submit `reject` with specific findings that the next maker can resolve
- submit `escalate` when evidence cannot support approval or bounded repair

Never invent an outcome, choose a graph edge, run the trusted check on the
worker's behalf, or treat hooks/forecasts as proof. Burnlist owns those checks,
transitions, budgets, and completion.

For Branch, choose genuinely separable slices and use independent workers when
available; otherwise execute the same slices sequentially. Keep integration
with one owner. Burnlist records the canonical branch node, while slice names
and native worker state remain host evidence.

If a provider fails before changing the workspace and its process has
definitely exited, retry the same provider-neutral task with another ready
provider. If cleanup or candidate state is uncertain, stop and use the
recovery guidance instead of submitting a made-up result.
