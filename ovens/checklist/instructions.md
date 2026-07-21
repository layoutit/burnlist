# Checklist

`checklist.oven` is the declarative, read-only detail view for a Burnlist checklist. It renders the current task, progress KPIs, completion ledger, burn chart, and completed-event cards without changing canonical Burnlist state.

## Data Shape

- Input mode: `json-payload`.
- Runtime validator: `validateGenericJsonData`.
- Starter data: none.

The runtime validator is the authority used by both `oven set` and the data
handler. It accepts any parsed JSON value; that establishes JSON readability,
not a field-shape or truth claim. No `example/data.json` is shipped, so `oven
use checklist` adopts the Oven without writing or binding data.

The view binds `checklist-progress@1` data after `adaptChecklist(data)` in `dashboard/src/lib/checklist-adapter.ts`. The payload contains:

- `raw`: the original checklist progress data consumed by the ledger, burn panel, and event cards.
- `current`: `{ title, value }` for the active-task KPI.
- `progress`: `{ done, total, percent, title }` for the progress KPI.
- `durations`: formatted `{ elapsed, pace, timeLeft }` KPI strings.
- `ledger`, `history`, and `events`: precomputed read models available to future declarative widgets.

The engine receives this payload from the dashboard on each data refresh. The oven has no write controls and never mutates the checklist, lifecycle folders, or registry.

## Active Checklist

The canonical `burnlist.md` Active Checklist remains the ordered source of pending work. Its completed ledger supplies the burned items shown by this read-only view; the dashboard never replaces or silently mutates either source of truth.
