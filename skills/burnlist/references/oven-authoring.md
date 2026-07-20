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
burnlist oven view   <id> [--json]
burnlist oven create <id> --dir <dir>            # reads instructions.md + <id>.oven
burnlist oven create <id> --package <file|->     # JSON: {name?, instructions, oven}
burnlist oven create <id> --instructions <f|-> [--oven <f|->] [--name <text>]
burnlist oven update <id> [same inputs as create]
```

- `view` derives structure from the compiled IR. Use it to inspect the Oven
  before and after authoring.
- Any file input accepts `-` to read stdin.
- `--name` owns the level-one heading; without it the instructions must already
  contain one.
- `create` scaffolds a starter `.oven` when one is omitted and refuses an
  existing id (use `update`, or `--force` to replace).
- `update` targets an existing custom Oven only. Built-in Ovens are read-only;
  fork one with `create <new-id> --dir <built-in path>`.
- Validation is identical to the dashboard: it reuses `oven-contract.mjs`.
  Invalid source or a missing H1 is rejected before anything is written.

## DSL Structure

The `.oven` grammar in `src/ovens/dsl/oven-grammar.mjs` defines the allowed
elements, attributes, and bindings. See `references/creating-ovens.md` and the
website [.oven DSL reference](/ovens/dsl-reference) for the full author-facing
vocabulary.

## Widgets and formats

Widgets and formats are the `.oven` DSL vocabulary. See
`references/creating-ovens.md` and the website [.oven DSL
reference](/ovens/dsl-reference).

## Binding Contract

A `.oven` source or binding is a JSON-pointer into a single read-only data
document that a project-specific adapter produces at view time. The adapter is
not part of the Oven, and the contract deliberately leaves the value shape
uncanonicalized. So the author and the adapter must agree on the document
shape out of band. Record the expected document in the Oven's `instructions.md`
(e.g. a `## State Contract` section) so the agreement is discoverable.

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
Its `.oven` source reads the `/loop/*` document the orchestrator adapter serves:

```xml
<oven id="loop-status" version="1" contract="checklist-progress@1" theme="checklist">
  <section-header title="Loop status"/>
  <kpi-strip>
    <kpi-item heading="Profile" source="/loop/profile"/>
    <kpi-item heading="Role" source="/loop/role"/>
    <kpi-item heading="Backend" source="/loop/backend"/>
    <kpi-item heading="Rounds" source="/loop/rounds" format="number"/>
  </kpi-strip>
  <log-table source="/loop/lanes"><column label="Lane" source="@item"/></log-table>
  <log-table source="/loop/defects"><column label="Defect" source="@item"/></log-table>
</oven>
```

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
