# Burnlist Splitting And Lanes

Read this reference before splitting, reordering, creating lane Burnlists, using parent/lane coordination, or handling recursive/refactor gates.

## Split Discipline

Split an active item only when it proves broader than expected and replacement items are independently finishable.

A split is required when an active item starts accumulating multiple named remaining targets, blockers, selectors, files, or proof routes that can be completed separately. Do not keep those as prose inside one rolling bucket item.

Each replacement item must preserve the original intent, cover the original scope completely, and have its own done/delete condition and validation/proof.

Prefer the next 2-3 highest-priority targets as flat ids such as `B12`, `B13`, then rename remaining active items as needed so the queue stays easy to scan. Do not use nested ids like `B11.2.1` unless the user explicitly asks for tree labels.

If more than 3 replacements seem necessary, keep a short umbrella item plus the next 2-3 flat follow-up items instead of splintering the whole queue. Exception: final gates, recursive gates, or census items may add a larger ordered batch only when every new item has a short title, concrete files/search, done/delete condition, and validation/proof. Report that as a split/gate decision, not routine progress.

When renumbering active items, preserve titles unless scope actually changes. Stable ids are labels; source order in `burnlist.md` is execution order.

Do not split for routine substeps, file-by-file narration, debugging breadcrumbs, or to show activity.

## Reorder And Pending Rules

Work from the top active item unless the user explicitly selected another item.

`Pending` is dashboard-computed for items still in `## Active Checklist`; never write it or use it as an agent decision to skip work. If the top active item is not the next work, explicitly split/reorder the queue or cite the user's selected item before continuing.

The only normal deletion from `## Active Checklist` is the current active item after a valid burn transaction. Do not silently remove future/pending items to shrink the queue. If a future item is wrong, make the correction explicit as a split, reorder, or contract repair.

## Census And Recursive Gates

For large refactor, migration, or architecture Burnlists, prefer one early census item before heavy edits. A census may write scoped notes to `scratch.md`: current file/folder counts, import/search hot spots, budgets, and candidate routes. Tie every scratch entry to the active item id.

After a substantial burn in a refactor/migration Burnlist, run a bounded recursive gate: inspect changed files, direct importers, and the next owner boundary named by `goal.md` or the current item. If it reveals real same-scope debt, add same-list follow-up items before claiming finality. Do not create a successor Burnlist or bury actionable next targets in `completed.md`.

## Lane Burnlists

A parent Burnlist may coordinate lane Burnlists under:

```text
notes/burnlists/inprogress/<id>/lanes/<lane>/
```

Use lanes only for large multi-scope refactors where a parent gate exposes at least two independent work scopes with distinct files, owners, or proof routes. Do not spawn lanes for one narrow fix, expected validation cleanup, ledger/dashboard work, or a single-file task.

The parent stays dashboard-facing and owns integration gates, final lifecycle state, and `scratch.md` merge summaries. Lane Burnlists are local execution queues, not separate lifecycle/dashboard runs.

Each lane needs:

- declared write scope
- forbidden overlap
- validation/proof command
- handoff condition back to parent

No two lanes may edit the same implementation file at the same time. If scopes overlap, serialize them through the parent or split ownership first.

Lane waves do not respawn automatically when lanes reach `0 active`. A later wave is valid only when the current parent gate proves new parallelizable scopes.

Do not burn a parent integration gate just because lane Burnlists are complete. Before the parent item burns, every relevant lane must be protocol-valid with `0 active`, the parent must review and integrate lane outputs, parent validation must pass, and parent `scratch.md` must summarize accepted outputs, dropped field classes, unsupported scope, and follow-up ids.
