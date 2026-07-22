# Burnlist Progress Dashboard

Read this reference only when changing or repairing the live Burnlist Progress dashboard, investigating chart/log behavior, or preparing a handoff where chart trust matters.

Burnlist Progress is queue state: active checklist items burn down and completed ledger entries move progress toward `100%`. Checklist is the default Oven for that behavior. Differential Testing is source-backed reference-versus-candidate state: aligned values move toward the trusted reference under a declared comparison contract. Keep the Differential Testing detail surface separate from this Progress dashboard and bind project data only through its normalized read-only contract.

## Canonical State

`burnlist.md` is canonical, shrinking task state. `goal.md` is the stable contract for agents. The dashboard is a read-only observer over `burnlist.md`.

The dashboard parses only:

- top metadata
- `Goal: ./goal.md`
- `## Active Checklist`
- terse `## Completed` ledger

Do not edit a plan just to feed the dashboard beyond the required completed-item ledger. Do not ask agents to maintain chart metadata, telemetry, progress fields, or dashboard-only annotations in the Burnlist.

## Running

Run one loopback dashboard index:

```sh
burnlist --port 4510
```

The dashboard scans lifecycle Burnlists at:

```text
notes/burnlists/{draft,ready,inprogress,completed}/*/burnlist.md
```

By default it scans the current working directory, its immediate child directories, `~/fed`, and immediate project directories under `~/fed`. To force a scope, pass comma-separated roots:

```sh
burnlist --port 4510 --scan-root /path/to/repo,/path/to/another-repo
```

The script binds only to loopback hosts by default, rejects oversized plan files, and caps local history growth. Occupied ports are a hard error by default. Use `--auto-port` only when a different port is acceptable.

Agents should not start, stop, or announce this server during ordinary Burnlist execution. Their responsibility is to keep each Burnlist folder in the right lifecycle directory. The dashboard is not a global Burnlist registry; it is a read-only index over discoverable repo folders.

## Dashboard URLs

`repoKey` is a 12-hex-character key. The dashboard uses these path-based URLs:

- `/` — dashboard index.
- `/r/<repoKey>/<burnlistId>` — a Burnlist detail.
- `/r/<repoKey>/<burnlistId>/o/<ovenId>` — that Burnlist through an Oven lens.
- `/r/<repoKey>/o/<ovenId>` — a repo-scoped Oven.
- `/ovens` — the Oven catalog.
- `/ovens/<ovenId>` — an Oven explainer page.

A Burnlist detail shows a lens switcher containing only Ovens whose data
contract fits its `checklist-progress@1` contract. Each link opens
`/r/<repoKey>/<burnlistId>/o/<ovenId>`; `checklist` is the default lens and
the active lens is highlighted. Ovens with other contracts are not offered.

The `/ovens` catalog lists built-in Ovens first, then custom Ovens, sorted by
name. Each card shows the Oven name, `id@version`, its `Contract: <contract>`
badge, Built-in or Custom badge (with a custom Oven's `repoKey`), description,
an **Open Oven explainer** link, and this copyable **Tell your agent** block:

```text
Use the <Name> Oven (<id>@<version>).
Its data must satisfy the <contract> contract.
Adopt the Oven before preparing its data:
burnlist oven adopt <id>
Produce the required data, then bind it to the target path:
burnlist oven bind <id> <path>
```

An `/ovens/<id>` explainer shows the Oven documentation and a demonstration
render with sample data. For the live, data-bound view, open the scoped
`/r/<repoKey>/o/<id>` or `/r/<repoKey>/<burnlistId>/o/<id>` URL instead.

Paginate the main Burnlist table after lifecycle filtering, with `20` rows per page. Store pages in `?page=<number>`, reset to page one when the lifecycle filter changes, clamp invalid or oversized pages, and preserve the current filter and page through detail and back links.

Place `New Oven` at the top right of the main table. Keep `Run Burn` off the primary dashboard controls; its direct `/runs/new` route remains available. The normative definition and ownership boundary are in `oven-contract.md`; this UI must preserve them. Checklist and Differential Testing are the only immutable default Ovens. New Oven creation is now `{id, name, instructions}` and the server scaffolds a starter `<id>.oven`; the drag-to-place grid detail-builder was removed. Persist custom Ovens under ignored `.local/burnlist/ovens/` state and immutable Run snapshots under `.local/burnlist/runs/`.

## Local Observer State

The index server may keep ignored local observer state under `.local/burnlist/checklist-progress/`, including capped append-only history snapshots for charts.

## Checklist Parsing

The dashboard parser supports checklist-mode `- [ ]` items and terse `## Completed` ledger lines for durable completion timestamps.

Render visible timestamps at `13px` across index, detail, and fallback dashboard surfaces.

It treats completed ledger entries as the only completion source. It displays current item ids and active checklist order exactly as written. Numeric ids are stable labels, not execution order after splits or reorders.

If an `inprogress/<id>/burnlist.md` parses as `total > 0`, `remaining = 0`, and `done = total`, the dashboard may classify it as `Done` for filtering and expose lifecycle-mismatch metadata. The dashboard must not mutate lifecycle folders on page load; the repair path is the explicit closeout command.

## Charts And KPIs

Completion charts should render as step charts when historical points are available, because checklist state changes at item/split events. A simple percentage bar is acceptable for the bundled dashboard.

For the `Tasks` KPI, the terse `## Completed` ledger is the completion source of truth. Compute completed count from completed ledger entries, remaining count from the active checklist, and total as completed plus remaining.

When a completed Burnlist is inspected from historical state, chart and timing views should end at the final completed ledger timestamp, not the current read time.

## Checks And Repairs

When the Burnlist or dashboard looks suspicious, run:

```sh
burnlist --plan notes/burnlists/inprogress/<YYMMDD-NNN>/burnlist.md --check
```

Fix only reported Burnlist protocol errors: missing sections, missing or duplicate stable ids, malformed completed ledger lines, completed ids still active, or checked active items that should be moved to `## Completed`.

If a Burnlist is 100% done but still appears under `inprogress/`, run:

```sh
burnlist --close-completed --scan-root <repo>
```

That command scans `inprogress/*`, skips anything with active items or protocol errors, appends a missing completion digest, and moves finished folders to `completed/<id>/`.

If the dashboard itself is broken or explicitly being improved, fix the index server/UI in a bounded slice while keeping the Burnlist as the canonical work queue.
