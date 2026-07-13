# Oven Authoring

Practical companion to `references/oven-contract.md`. The contract is normative
for the package shape and validation; this reference documents the controlled
vocabulary and the `burnlist oven` CLI so an Oven can be authored without
hand-writing JSON. Read it when creating, updating, or inspecting an Oven.

An Oven never executes anything. Authoring writes only custom Ovens under
ignored `.local/burnlist/ovens/` state, and changes affect only future Runs.

## CLI

```sh
burnlist oven list [--json]
burnlist oven view   <id> [--json] [--cell-width <n>] [--cell-height <n>]
burnlist oven create <id> --dir <dir>            # dir holds instructions.md + detail.json
burnlist oven create <id> --package <file|->     # JSON: {name?, instructions, detail}
burnlist oven create <id> --instructions <f|-> --detail <f|-> [--name <text>]
burnlist oven update <id> [same inputs as create]
```

- `view` prints the detail skeleton as a box-drawing grid plus a section table
  (widget, format, source, cell, span). Use it to see the layout before and
  after authoring.
- Any file input accepts `-` to read stdin.
- `--name` owns the level-one heading; without it the instructions must already
  contain one.
- `create` refuses an existing id (use `update`, or `--force` to replace).
- `update` targets an existing custom Oven only. Built-in Ovens are read-only;
  fork one with `create <new-id> --dir <built-in path>`.
- Validation is identical to the dashboard: it reuses `oven-contract.mjs`. A
  bad grid (overlap, out-of-bounds span, unknown widget/format, missing H1) is
  rejected before anything is written.

## Grid Rules

From the contract, enforced at creation time:

- `columns` 2–24, `rows` 2–32, `rowHeight` 32–120, `version` 1.
- 1–32 sections. Each section id is a lowercase slug, unique within the Oven.
- `column`/`row` are 1-based; `column + columnSpan - 1 <= columns` and likewise
  for rows. Sections may not overlap.
- `source` is empty (unbound) or a JSON-pointer-like string starting with `/`.

## Widget Vocabulary

Fourteen controlled widgets. The recommended source-value shape is a
convention between the Oven author and the adapter that serves the data; it is
**not** validated at creation time, and the renderer is the final authority.

| widget | intent | recommended value at `source` |
| --- | --- | --- |
| `metric` | one headline number or short value | scalar (`number` or short `string`) |
| `progress` | completion toward a whole | number in `0..1` (or `0..100` with `percent`) |
| `comparison` | paired reference-vs-candidate series (Differential Testing) | array of field records, each with `samples: [[tick, ref, cand, state]]` |
| `status` | one short state label | short `string` / enum |
| `timestamp` | a single moment | ISO-8601 `string` |
| `line-chart` | trend over an ordered axis | array of `{ x, y }` points (or named series) |
| `bar-chart` | compare discrete categories | array of `{ label, value }` |
| `pie-chart` | parts of a whole | array of `{ label, value }` |
| `chart` | generic series; renderer picks | array of points/series |
| `table` | rows and columns | `{ columns: string[], rows: any[][] }` or array of objects |
| `list` | ordered/unordered items | array of `string` or `{ label, ... }` |
| `timeline` | events in time order | array of `{ timestamp, label }` |
| `log` | append-only lines | array of `string` or `{ timestamp, message }` |
| `markdown` | prose / rich text | `string` of Markdown |

## Format Vocabulary

Five controlled formats applied to a widget's value: `plain`, `number`,
`percent`, `duration`, `timestamp`. `plain` is the default.

## Binding Contract

A bound section's `source` is a JSON-pointer into a single read-only data
document that a project-specific adapter produces at view time. The adapter is
not part of the Oven, and the contract deliberately leaves the value shape
uncanonicalized. So the author and the adapter must agree on the document
shape out of band. Record the expected document in the Oven's `instructions.md`
(e.g. a `## State Contract` section) so the agreement is discoverable.

An unbound section (empty `source`) is a layout placeholder that renders no
data.

For a **rich built-in Oven** the shape is *not* left open: the renderer defines a
**versioned normalized-data contract** validated in code — e.g. Differential
Testing uses `burnlist-differential-testing-data@1`
(`differential-testing-data-contract.mjs`), bound via `--oven-data`. Producing a
conforming payload has a packaged **adapter SDK**
(`burnlist differential-testing sdk` → `differential-testing-adapter-sdk.mjs`)
that owns the mechanical refresh/lock/atomic-publish plumbing while the project
keeps evidence authority. See `references/differential-testing-adapter-sdk.md`.

## Worked Example: `loop-status`

An Oven that observes the role-separated execution loop for one Burnlist item.
Its sections bind to a `/loop/*` document the orchestrator adapter serves:

| section | widget | source |
| --- | --- | --- |
| `profile` | `status` | `/loop/profile` |
| `role` | `status` | `/loop/role` |
| `backend` | `metric` | `/loop/backend` |
| `lanes` | `list` | `/loop/lanes` |
| `defects` | `log` | `/loop/defects` |
| `rounds` | `metric` (`number`) | `/loop/rounds` |

The adapter contract — the document those pointers read:

```json
{
  "loop": {
    "profile": "L3 deep",
    "role": "Luna",
    "backend": "claude",
    "rounds": 2,
    "lanes": [
      "contract/compatibility — pass",
      "resilience/security — pass",
      "performance/resources — running",
      "visual/interaction — pass",
      "integration/regression — fail"
    ],
    "defects": [
      "2026-07-10T01:12:03+02:00 integration/regression: session rotation drops CSRF token"
    ]
  }
}
```

The Oven only reads this. Loop policy — required Terra lanes must all pass
before an item is accepted, separate direction-Sol and final-Sol contexts,
escalation on a repeated defect — lives in the orchestrator, not the Oven.

## Boundaries

An Oven, and this CLI, may not execute instructions, produce project data, own
canonical project state, mutate Burnlists, import UI code, or start an agent.
Custom Ovens are local and affect only future Runs.
