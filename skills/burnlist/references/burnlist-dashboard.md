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

Paginate the main Burnlist table after lifecycle filtering, with `20` rows per page. Store pages in `?page=<number>`, reset to page one when the lifecycle filter changes, clamp invalid or oversized pages, and preserve the current filter and page through detail and back links.

Place `New Oven` and `Run Burn` at the top right of the main table. The normative definition and ownership boundary are in `oven-contract.md`; this UI must preserve them. Checklist and Differential Testing are the only immutable default Ovens. Each positioned detail section chooses a controlled chart type by icon and stores one plain-language metric description; it may remain unbound until a project adapter supplies normalized data. Keep Columns and Rows with the upper Oven definition fields, and use a fixed `50px` row-height constant for newly built skeletons instead of exposing row-height configuration. Persist custom Ovens under ignored `.local/burnlist/ovens/` state and immutable Run snapshots under `.local/burnlist/runs/`. The grid builder should faithfully reuse aiterator's rectangle-drag interaction pattern, but not its raw HTML generation path.

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
