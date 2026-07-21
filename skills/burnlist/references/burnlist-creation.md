# Burnlist Creation Mode

## Purpose

Use this mode to produce the canonical Burnlist folder that an execution pass can run. Creation is planning-heavy and execution-free: inspect the repo, ask only material hardening questions, write or repair the stable goal contract plus the active queue, validate the Burnlist protocol, then stop.

Do not implement code changes, stage files, commit, push, deploy, start long test suites, or run the live dashboard as a default creation step. If the user asks to implement immediately after creation, finish creation by parking the folder in `ready/`, then switch to Burnlist execution mode; execution begins by moving the folder from `ready/` to `inprogress/`, where the user-run dashboard index treats it as active.

## Output Contract

Create or update one repo-local Burnlist folder. Use the user-named path if provided; if the user names a `burnlist.md` path, treat its parent directory as the Burnlist folder. Otherwise use:

```text
notes/burnlists/draft/<YYMMDD-NNN>/
```

Choose the plan location with these rules:

1. Use the path named by the user.
2. If the target work lives in a normal project git repository, use that repository root.
3. If the target is a reusable Codex skill under `$HOME/.agents/skills` or a repo `.agents/skills` directory, do not write Burnlist artifacts into the skill folder; use the active project or thread workspace instead.
4. If there is no git repository, use the active project directory.

Use a short stable id for the folder: `YYMMDD-NNN`, such as `260630-001`. Pick the next unused number for that date by scanning `notes/burnlists/draft`, `notes/burnlists/ready`, `notes/burnlists/inprogress`, and `notes/burnlists/completed` inside the selected repo. The id is repo-local, not globally unique; `260630-001` may exist in multiple repos. The global identity is the repo root plus the id, and dashboard/API links use the absolute `burnlist.md` path. The id must never change after creation; lifecycle state is represented by moving the whole folder.

Lifecycle layout:

```text
notes/burnlists/
  draft/<YYMMDD-NNN>/goal.md
  draft/<YYMMDD-NNN>/burnlist.md
  draft/<YYMMDD-NNN>/scratch.md
  ready/<YYMMDD-NNN>/goal.md
  ready/<YYMMDD-NNN>/burnlist.md
  ready/<YYMMDD-NNN>/scratch.md
  inprogress/<YYMMDD-NNN>/goal.md
  inprogress/<YYMMDD-NNN>/burnlist.md
  inprogress/<YYMMDD-NNN>/scratch.md
  inprogress/<YYMMDD-NNN>/completed.md
  completed/<YYMMDD-NNN>/goal.md
  completed/<YYMMDD-NNN>/burnlist.md
  completed/<YYMMDD-NNN>/completed.md
```

Burnlist creation mode owns `draft -> ready`. It may harden an existing `draft/` Burnlist in place and move it to `ready/` only after the final pass and protocol validation. It must not move a folder to `inprogress/` or `completed/`; that is execution state owned by Burnlist execution mode. A `ready/` Burnlist is finalized but not started. If it needs major reshaping, explicitly move it back to `draft/` and return to creation mode before execution.

When hardening a legacy Burnlist that predates `goal.md`, migrate it to the split shape only in `draft/` or `ready/`, or when the user explicitly asks for migration. Move stable `## Goal`, `## Guardrails`, `## Stop Conditions`, `## Handoff`, proof authority, and ordering intent into `goal.md`; leave `burnlist.md` with metadata, `Goal: ./goal.md`, `## Active Checklist`, and `## Completed`. Do not migrate active `inprogress/` Burnlists as a side effect of creation work.

`goal.md` is required. It is the stable contract for the Burnlist: title, repo, goal, guardrails, stop conditions, handoff or ordering intent, proof authority, and scope boundaries. Put durable context there, not in `burnlist.md`.

`scratch.md` is optional. Use it only for task-scoped working notes that would pollute `burnlist.md`: source anchors, command snippets, short evidence excerpts, rejected hypotheses, or draft notes before promotion into an item. Every scratch entry must be associated with a current or historical item id such as `B3`; do not write unscoped global scratch. Keep it bounded and non-canonical: anything required for execution must be promoted into `burnlist.md` or `goal.md`.

Do not create `completed.md` during normal draft creation. It is created in execution mode when the first item is burned. `completed.md` is durable history, not task state.

Use this `goal.md` shape:

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

Use this `burnlist.md` shape:

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
```

After writing or updating a Burnlist, report the absolute repo path, absolute `goal.md` path, absolute `burnlist.md` path, repo-local Burnlist id, whether the folder was parked in `ready/` or remains in `draft/`, whether the active queue is ready to execute, and any blocker that prevents immediate execution. Do not stage the Burnlist.

## Creation Flow

Use one folder and four passes. Do not create parallel draft files, separate plan notes, or dashboard state. Unless the user explicitly asks to see drafts, iterate privately and leave only the final `goal.md` contract and `burnlist.md` queue.

1. Draft pass: inspect enough repo evidence to make a first concrete Burnlist draft. Identify the repo root, target files, relevant domain skill or repo-local rules, hard exclusions, likely proof commands, and the first executable item. Put durable boundaries in `goal.md`.
2. Actionability pass: review every item as if another agent must execute it with no extra conversation. Each item must name concrete files/search targets, a specific action, a done/delete condition, and a validation command or artifact. Rewrite vague items, split multi-target items, and ask a hardening question only if actionability depends on the answer.
3. Chainability pass: inspect whether the item order forms a useful chain. Each item should unlock, de-risk, or depend on earlier proof. Put source facts, blockers, contracts, or narrow proof-unlocks before runtime changes, broad cleanup, dashboards, campaigns, or final audits. If adjacent items can be swapped with no consequence, merge, split, or reorder until the sequence has visible next-step logic.
4. Final pass: apply the checklist quality gate, clean dashboard titles, verify flat ids and required sections, run the protocol check if available, verify `goal.md` exists and active items do not contradict it, then move the whole folder to `ready/<YYMMDD-NNN>/` if the queue is execution-ready. If blockers remain, keep it in `draft/` and report why. Do not keep unresolved review notes inside `burnlist.md`; convert them into `goal.md` contract text or executable items.

## Hardening Questions

Ask questions only when the answer materially changes the checklist shape. Prefer one concise question; never ask more than three at once.

Good hardening questions target:

- scope boundaries: what is explicitly out of bounds?
- proof authority: what command, oracle, source trace, screenshot, dashboard, or artifact is allowed to prove completion?
- ordering: what must be true before runtime/UI/deploy work starts?
- risk tolerance: should the first pass favor source truth, speed, UX, compatibility, or cleanup?
- local-state policy: should the artifact be ignored/local-only, tracked, or placed outside the repo?

If a reasonable default is clear from repo evidence, do not block on a question. Record durable assumptions in `goal.md` or item-specific assumptions in the relevant item body.

## Proof Authority: cite an Oven number

An item's proof authority may be an objective Oven signal rather than a self-report. When a Burnlist tracks work an Oven measures, write the done/delete condition to cite that number, for example: "Done/delete when Oven `migration-status` shows `validatedFraction = 100%` and `schemaFailures = 0`."

This is **advisory evidence a human or agent reads. Burnlist does not execute the Oven or auto-verify the number**—`burnlist burn` and `burnlist --check` validate the Burnlist protocol and record the burn; they never read Oven data or the adapter's bound JSON. The honesty is that the proof points at an adapter-computed signal the worker cannot type by hand. Record which Oven and which pointer are authoritative in `goal.md` under `## Proof Authority`. See [Designing Ovens](designing-ovens.md) for the adapter that computes the number and [Oven Authoring](oven-authoring.md) for binding it.

## Checklist Quality Gate

The checklist is the product. Before finalizing:

- One active item represents one independently burnable work object, not a theme, bucket, research area, or vague phase.
- The checkbox line is the dashboard title. Keep it short after the `id |` boundary; put `Files/search`, `Action`, `Done/delete when`, and `Validate` on indented body lines.
- The first item is immediately executable from repo evidence already gathered. If discovery is required first, make that discovery a concrete item with its own proof.
- Order is visible. If two adjacent items can be swapped without changing execution, merge, split, or reorder until the sequence has a reason.
- Every item names concrete files/search targets and a proof command or artifact. Avoid bare verbs such as "improve", "investigate", "handle", "continue", "finish", or "clean up" unless the item also names the observable proof.
- Every item has a delete test: after proof passes, the item can be removed without losing context needed by later items.
- Split before finalizing if one item contains multiple named blockers, targets, selectors, files, routes, or proof paths that can be completed separately.
- Keep background evidence in `goal.md` or the item that needs it. Do not turn active items into narrative storage.

## Split And Numbering Rules

- Use flat ids such as `B1`, `B2`, `B3`. Do not use nested ids like `B4.1`.
- If an item is too broad during creation, replace it with the next 2-3 highest-value flat items and keep an umbrella item only when more than three replacements would splinter the list.
- Each replacement item must preserve the original intent, cover the original scope completely, and have its own done/delete condition and validation/proof.
- Keep titles short and dashboard-readable. Execution details belong under the item, not on the checkbox line.

## Validation

If the shared Burnlist dashboard script is available, run:

```sh
burnlist --plan notes/burnlists/draft/<YYMMDD-NNN>/burnlist.md --check
```

Fix only protocol errors before reporting readiness: missing sections, missing or duplicate stable ids, malformed completed ledger lines, completed ids still active, checked active items, or title/body shape problems that break dashboard readability. The protocol check validates `burnlist.md` only; separately verify `goal.md` exists and that the active queue does not contradict its contract.

Do not start the live dashboard by default. The dashboard index is user-run and discovers lifecycle Burnlists under `notes/burnlists/{draft,ready,inprogress,completed}/`.

## CLI Lifecycle Verbs

- `burnlist new [--repo <path>]` creates a draft Burnlist scaffold.
- `burnlist show <id>[#<item>] [--repo <path>]` prints a Burnlist summary or item.
- `burnlist ready <id> [--repo <path>]` moves a contentful draft to `ready/`.
- `burnlist start <id> [--repo <path>]` moves a ready Burnlist to `inprogress/`.
- `burnlist close <id> [--repo <path>]` digests and moves a complete in-progress Burnlist to `completed/`.
- `burnlist burn <id> <item> [--check] [--repo <path>]` records and removes one active item.

## Handoff

End with:

- Absolute repo path.
- Absolute `goal.md` path.
- Absolute Burnlist file path.
- Burnlist id, treated as repo-local.
- Scratch file path if one was created.
- Lifecycle state: `ready` if finalized, or `draft` if blocked.
- Whether the active queue is ready.
- The first item title and why it is first.
- Any unresolved hardening question or assumption that affects execution.

Do not include implementation progress, test logs, dashboard telemetry, or a second planning artifact.
