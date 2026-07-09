# Burnlist Protocol

Read this reference only for lifecycle moves, file shapes, protocol repair, closeout, legacy migration, local artifacts, or when the normal path in `SKILL.md` is not enough.

## Lifecycle

Burnlist state is represented by moving the whole folder:

```text
notes/burnlists/draft/<YYMMDD-NNN>/
notes/burnlists/ready/<YYMMDD-NNN>/
notes/burnlists/inprogress/<YYMMDD-NNN>/
notes/burnlists/completed/<YYMMDD-NNN>/
```

`draft/` means the plan is still being created or hardened. Do not execute it. `ready/` may be inspected and selected, but do not casually rewrite it during execution. Move `ready/<id>/` to `inprogress/<id>/` before selecting, editing, testing, or deleting any active item.

The id is repo-local, short, sortable, and stable, such as `260630-001`. Multiple repos may each have the same id. The global identity is repo root plus id. If a prompt gives only a bare id and the current repo is unclear, use an explicit path or ask.

Before moving a folder, verify the Burnlist `Repo:` field matches the current git root when a git root exists.

## File Shapes

`goal.md` is the stable contract:

```markdown
# <Topic> Goal

Repo: `<absolute repo path>`

## Goal
## Guardrails
## Proof Authority
## Ordering Intent
## Stop Conditions
## Handoff
```

`burnlist.md` is hot task state:

```markdown
# <Topic> Burnlist

Status: Burnlist Final
Updated: <YYYY-MM-DD>
Repo: `<absolute repo path>`
Goal: ./goal.md

## Active Checklist
- [ ] B1 | <short dashboard title>
  Files/search: `<paths or rg terms>`
  Action: <specific action>
  Done/delete when: <observable proof>
  Validate: `<command or artifact>`

## Completed
- B0 | <YYYY-MM-DDTHH:mm:ss±HH:mm> | <short completed item title>
```

`scratch.md` is optional, bounded, and not canonical task state. Use it only for task-scoped notes that would otherwise pollute the Burnlist. Every scratch entry must name an item id. Promote anything still needed for execution into `burnlist.md`; contract changes belong in `goal.md` and may require switching back to Burnlist creation mode.

`completed.md` is optional durable per-burn history for humans:

```markdown
## B7 | <short item title>

Completed: <YYYY-MM-DDTHH:mm:ss±HH:mm>
Changed:
- `<file or artifact path>`
Proof:
- `<command or artifact>`
Outcome:
- <one sentence about what changed or was proven>
Follow-up:
- <next item id, short note, or None>
```

If no files changed, write `Changed: None`. Do not paste raw logs, dashboard telemetry, broad reasoning, or progress narration. The terse `## Completed` ledger in `burnlist.md` remains canonical.

## Burn Transaction

A burn completion is one atomic transaction:

1. validate the active item
2. generate a local ISO timestamp mechanically
3. append one `## Completed` ledger line
4. delete the active item
5. append or update the matching `completed.md` record when useful
6. run the Burnlist protocol check

Do not hand-type date-only timestamps. Prefer:

```sh
burnlist --stamp
```

Expected passing tests, expected file edits, routine searches, stamp generation, ledger writes, completed-record writes, and protocol checks are not visible checkpoints by themselves.

## Protocol Check

Run:

```sh
burnlist --plan notes/burnlists/inprogress/<YYMMDD-NNN>/burnlist.md --check
```

Fix only reported protocol errors: missing sections, missing or duplicate stable ids, malformed completed ledger lines, completed ids still active, or checked active items that should be moved to `## Completed`.

## Closeout

A Burnlist is not fully closed just because it shows 100%. Closeout means:

1. `0` active items
2. completion digest appended if missing
3. protocol check passes
4. folder moved from `inprogress/<id>/` to `completed/<id>/`

Generate the finish digest only when work is complete:

```sh
burnlist --plan notes/burnlists/inprogress/<YYMMDD-NNN>/burnlist.md --digest
```

If a completed Burnlist is stuck under `inprogress/`, repair lifecycle state with:

```sh
burnlist --close-completed --scan-root <repo>
```

## Legacy Burnlists

Legacy Burnlists may still have `## Goal`, `## Guardrails`, `## Stop Conditions`, or `## Handoff` inside `burnlist.md`, or may lack `goal.md`. Do not force-migrate an active legacy Burnlist just to satisfy the new shape. Finish it in place unless migration is explicitly requested or the old shape is causing concrete confusion.

If migration is needed, do it at a quiet boundary: create `goal.md` from stable sections, leave `burnlist.md` with metadata plus active checklist and completed ledger, run `--check`, then continue.

## Local Artifacts

Keep local-only artifacts local. If inside a git repo and local-only output matters, use:

```sh
git ls-files notes/burnlists notes
```

If the repo tracks `notes/` and the user explicitly requires untracked output, stop and ask whether to use another local path or add a local exclude.
