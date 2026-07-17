---
name: burnlist
description: >-
  Create, harden, execute, maintain, and repair repo-local Burnlists: turn goals into strict shrinking checklists, finalize draft-to-ready plans, run active items with atomic completion, split or reorder work, coordinate parent and lane Burnlists, manage lifecycle folders and terse completed ledgers, and repair the local dashboard/tracker. Use for both planning a new Burnlist and implementing or continuing an existing one.
---

# Burnlist

Use one skill for the full Burnlist lifecycle. Burnlist is task state, not implementation strategy; let the repo or domain skill own code, tests, browser or oracle evidence, performance rules, deploy rules, and PR packaging.

## Choose A Mode

- **Creation mode:** when creating, hardening, restructuring, or readying a Burnlist, read `references/burnlist-creation.md` completely before editing Burnlist files. Creation owns `draft -> ready` and does not implement the planned work unless the user also asks to continue into execution.
- **Execution mode:** when implementing or continuing a ready/in-progress Burnlist, follow the execution path below. Keep the hot working set small: the active item, relevant `goal.md` guardrails, current implementation evidence, and the state mutation being performed.
- **Combined request:** finish and validate creation first, park the folder in `ready/`, then switch explicitly to execution mode and move the whole folder to `inprogress/`.

## Cold References

Read references only when their trigger applies:

- `references/burnlist-creation.md`: mandatory for creation, hardening, draft repair, and `draft -> ready` work.
- `references/burnlist-protocol.md`: lifecycle moves, required file shapes, `goal.md`, `completed.md`, scratch, legacy migration, closeout, local artifacts.
- `references/burnlist-splitting-lanes.md`: split/reorder decisions, recursive gates, parent/lane Burnlists, parallel lane handoff.
- `references/burnlist-visible-output.md`: detailed silence rules, forbidden narration examples, checkpoint policy.
- `references/burnlist-dashboard.md`: dashboard/chart/log/timeline/repo-graph behavior or dashboard repair only.
- `references/installation.md`: installing or removing the agent skill or Streaming Diff edit-capture hooks.
- `references/oven-authoring.md`: authoring or inspecting Ovens from the `burnlist oven` CLI, the widget/format vocabulary, and source-binding conventions.

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

The live dashboard is mandatory as an observer, but agents do not own its server lifecycle. Do not start a per-plan server, manage ports, claim a dashboard URL, or inspect dashboard UI unless the user asks or dashboard behavior is the task.

The dashboard scans lifecycle folders and is read-only. `burnlist.md` and lifecycle folder location are canonical task state. Dashboard charts/logs/repo graphs are observer evidence, not implementation proof.

### Project registry

The dashboard observes burnlists across a machine-local registry of repo roots (`~/.burnlist/roots.json`) unioned with the current repo, so one dashboard can cover every registered project. Registration is **always explicit** — the CLI is the only writer and nothing auto-registers:

- `burnlist init [path]` — for a **new** repo: scaffold `notes/burnlists/{draft,ready,inprogress,completed}/`, git-ignore that state locally (via `.git/info/exclude`; `--track` commits it with `.gitkeep`s instead), and register the root.
- `burnlist register [path]` — for an **existing** repo that already has burnlists: register only (no scaffolding, no ignore change).
- `burnlist unregister [path]` — remove a repo root.
- `burnlist roots [--prune]` — list registered roots with health (`healthy`/`empty`/`missing`/`unreadable`); `--prune` drops only missing ones.

A burnlist in an unregistered repo is still visible when the dashboard is launched inside it, but not in the global landing until `init`/`register`. Hint the user to register; never auto-register. Observation spans all registered repos, but mutating verbs (`--close-completed`, lifecycle moves) act only on the current repo.

`New Oven` and `Run Burn` are explicit user-controlled local controller surfaces. For Oven contract, UI, validation, or Run-snapshot work, read `references/oven-contract.md`. Preserve its two-file declarative package and ownership boundary: custom Ovens may be created under ignored `.local/burnlist/ovens/` state and snapshotted under `.local/burnlist/runs/`, but neither surface may execute instructions, produce project data, own canonical project state, mutate Burnlists, import arbitrary UI code, or start an agent.

Ovens can also be authored and inspected from the CLI: `burnlist oven <list|view|create|update>`. It writes only custom Ovens, keeps built-in Ovens read-only, reuses the same contract validation, and never executes instructions. `burnlist oven view <id>` renders the detail skeleton as a box-drawing grid for quick inspection. Read `references/oven-authoring.md` for the widget/format vocabulary and source-binding conventions.

Do not embed repo/domain dashboards inside the Burnlist dashboard. Domain-specific viewers must live in their repo-local tools and may be linked or launched separately. Share state only through Burnlist lifecycle files, explicit URLs, or a narrow message contract; do not share CSS, layout code, routes, or polling loops.

Read `references/burnlist-dashboard.md` only for dashboard/chart/log/timeline/repo-graph questions or dashboard repair.

## Agent Installation Systems

Burnlist has two independent installable systems. Either or both may be present:

- **Skill discovery** (`burnlist install`) makes this Burnlist skill discoverable to both agents. The default is a per-repository, untracked-local registration in `<repo>/.claude/skills/burnlist` for Claude Code and `<repo>/.agents/skills/burnlist` for Codex. `--global` instead uses `~/.claude/skills/burnlist` and `~/.agents/skills/burnlist`; a global npm installation of Burnlist automatically registers both global skills. Use `--commit` only for a per-repository portable copy intended for Git; `--agent codex,claude` limits targets and `--dry-run` previews. `burnlist uninstall` is the inverse; `burnlist uninstall --global --purge` also removes the global npm package.
- **Streaming Diff hooks** (`burnlist hooks install`) install per-repository edit-capture commands, not skills. Codex consumes `<repo>/.codex/hooks.json`; Claude Code consumes `<repo>/.claude/settings.json`. They invoke `burnlist streaming-diff hook` for session/edit events and merge with existing hook entries. Hooks have no global mode: use `burnlist hooks uninstall` or `burnlist hooks status` in the repository, optionally with `--agent codex,claude`. `--untracked` asks install to add the config to `.git/info/exclude`; it cannot hide an already tracked config.

Install only the system the task needs, or both. Read `references/installation.md` for exact commands, ownership, and shared-versus-local behavior.
