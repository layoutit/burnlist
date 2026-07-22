# Oven Authoring

Practical companion to `references/oven-contract.md`. The contract is normative
for the package shape and validation; this reference documents the controlled
vocabulary and the `burnlist oven` CLI so an Oven can be authored without
hand-writing JSON. Read it when creating, updating, binding, or inspecting an
Oven.

## Closed contract and theme allowlist

**A custom Oven cannot define a new contract, theme, or icon.** It must reuse an
allowlisted contract and theme pair. For a generic KPI-and-table Oven that reads
arbitrary project JSON, use `contract="checklist-progress@1"` and
`theme="checklist"`. The choice governs the chrome and normalized-data contract
the matching shipped handler validates.

The complete closed registries are:

| Registry | Exact allowed values |
| --- | --- |
| contracts | `checklist-progress@1`, `burnlist-differential-testing-data@1`, `burnlist-model-lab-data@1`, `burnlist-streaming-diff-data@2`, `burnlist-visual-parity-data@1` |
| themes | `checklist`, `differential-testing`, `streaming-diff`, `visual-parity` |
| icons | `ClipboardList`, `Clock3`, `Gauge`, `TimerReset` |

Creation rejects unknown entries before writing, for example:

```text
burnlist oven: Oven <id> .oven source is invalid: Unknown theme <x>
burnlist oven: Oven <id> .oven source is invalid: Unknown contract <x>
```

The differential-testing, streaming-diff, and visual-parity widgets and the
eight Differential-Testing-only formats are for their matching contracts. A
generic Oven should use `kpi-strip`/`kpi-item`, `section-header`,
`log-table`/`column`, and the plain formats described in
`references/creating-ovens.md`.

An Oven never executes anything. Custom-Oven authoring writes only under ignored
`.local/burnlist/ovens/` state, and changes affect only future Runs. Vendoring a
shipped Oven uses the committed per-project path described below.

## Start with `burnlist init`

Run `burnlist init` once from the repository before `oven create`. In a Git
repository, create refuses to write until `.local/` is ignored:

```text
burnlist oven: refusing to write .local/burnlist/ovens: not git-ignored; run `burnlist init` or add it to .gitignore
```

`burnlist init` fixes that local prerequisite and registers the repository as a
dashboard scan root:

```text
Initialized 4 lifecycle folders in <repo>.
Ignored /notes/burnlists/ and /.local/ locally.
Registered <repo>.
```

It adds `/.local/` and `/notes/burnlists/` to `.git/info/exclude`. In a non-Git
directory that ignore step is skipped; creation works because the gate applies
only inside a Git repository that does not ignore the path.

## CLI

```sh
burnlist oven list [--json]
burnlist oven view <id> [--json]
burnlist oven use <id> [--repo <path>] [--force]
burnlist oven set <id> <path|-|json> [--repo <path>]
burnlist oven bind <id> <path> [--repo <path>]
burnlist oven unbind <id> [--repo <path>]
burnlist oven bindings [--repo <path>]
burnlist oven adopt <id> [--repo <path>] [--force]
burnlist oven upgrade <id> [--repo <path>]
burnlist oven create <id> --instructions <file|-> [--oven <file|->] [--name <text>]
burnlist oven create <id> --dir <dir>
burnlist oven create <id> --package <file|->
burnlist oven update <id> [same inputs as create]
burnlist oven fork <id> <newId>
```

- `list` lists custom and official Ovens with `id`, `version`, `name`, `origin`,
  `contract`, `nodes`, and `revision` columns. Its Oven identity is
  `id@version`; `version` is distinct from the `o1-sha256:<hex>` content
  revision. `--json` also exposes `origin`, and official entries include the
  current `catalogRevision` and `catalogEntry` metadata.
- `view` prints compiled structure only; it never prints bound data values. Its
  header identifies a shipped Oven as, for example,
  `Checklist  (checklist@0.1.0 · official)`, then reports `version`, `nodes`,
  `contract`, `theme`, `revision`, and `path`. `--json` includes `version` and
  `ovenRevision` plus the same origin and catalog metadata.
- `use` adopts a shipped Oven and, only if the shipped directory contains an
  exact `example/data.json`, validates and installs that example. Without one,
  it adopts only and prints the exact `oven set` next step.
- `set` reads JSON from a file, stdin (`-`), or an inline JSON argument,
  validates before mutation, and atomically publishes the canonical data file
  plus binding.
- `bind` records an Oven-to-data-file binding.
- `unbind` removes an Oven-to-data-file binding.
- `bindings` lists all recorded bindings.
- `adopt` copies a shipped Oven into the committed
  `.burnlist/ovens/<id>/` directory and records its pin in `pin.json`. It
  prints `Adopted Oven <id>@<version> at <repo>/.burnlist/ovens/<id>`.
  Existing vendored Ovens require `--force`, otherwise it reports
  `burnlist oven: Oven <id> is already vendored at <path>.`
- `upgrade` is the opt-in re-copy of a newer shipped Oven into its vendored
  directory. It prints `Upgraded Oven <id>@<version> at
  <repo>/.burnlist/ovens/<id>` followed by `revision: o1-sha256:<hex>`.
- `create` adds a custom Oven; `update` changes an existing custom Oven only.
- `fork` copies an official or custom Oven into a new custom id and records its
  `forkedFrom` provenance. Official Ovens are read-only and cannot be updated.

For `create`, `--dir` reads `instructions.md` and `<id>.oven`; `--package`
reads JSON `{name?, instructions, oven}`. Any file input accepts `-` for stdin.
`--name` owns the level-one heading; without it, instructions must already
contain one. Creation scaffolds a starter `.oven` when omitted, rejects an
existing id unless `--force` is given, and validates before writing. `--repo`
selects the repository whose binding storage is used.

## Validated `use` and `set`

Use a shipped Oven in a repository, then set its data when no starter exists:

```sh
burnlist oven use differential-testing --repo .
burnlist oven set differential-testing ./differential-testing.json --repo .
```

`use` keeps the existing `adopt` and pin semantics. It looks only for the
non-executable shipped file `ovens/<id>/example/data.json`. When that exact file
exists, `use` validates it and transactionally installs the Oven, data, and
binding. When it does not exist, adoption still succeeds, no data or binding is
created, and the CLI prints `burnlist oven set <id> <data> --repo <repo>`.
Reference/candidate inputs, test fixtures, schemas, and instructions are never
converted into starter data. The optional example is not vendored and does not
enter the Oven revision or pin. `--force` has the same deterministic duplicate
behavior as `adopt`.

An example or fixture proves only the mechanic it targets. It cannot promote a
shipped definition's official acceptance state. Use
`unit-fixture` or `transport-fixture` for synthetic checks, `catalog-route` for
the `/ovens` inventory surface, and `canonical-oven` only for a real
source-owned producer on its canonical route. The canonical class must pass
`scripts/verify-official-oven-evidence.mjs`; otherwise keep the catalog entry
`unverified` or `blocked`.

`set` resolves a repo's vendored Oven before the shipped or custom source. For an
official Oven, it calls the same runtime validator used by that Oven's render handler;
there is no second schema-based approximation. A producer-managed Oven such as
Streaming Diff refuses a single JSON payload. A custom Oven with no registered
runtime validator checks that every `.oven` `source=` and `<bind source=>`
pointer resolves, then prints this explicit warning:

```text
shape-only validation checks source pointers, not payload truth.
```

Shape is not truth: pointer presence does not prove types, freshness,
provenance, semantic correctness, or that adapter-computed evidence is honest.
Any JSON Schema shipped near an Oven is informational reference documentation,
not `set` authority and not package or pin content.

Only after validation succeeds does `set` pretty-print the payload to the
gitignored canonical path `.local/burnlist/data/<id>.json` and atomically update
`.local/burnlist/bindings.json`. A failure on a fresh install writes and binds
nothing. A rejected replacement or publication failure preserves the exact
prior data bytes and binding. Repeating an identical set is idempotent.

After that canonical transaction succeeds, `set` best-effort publishes one
`data-published/complete` Oven event whose cursor is the canonical JSON content
digest. The event write happens after the repository data lock is released and
never rolls back a successful set. Repeating identical data retries the same
idempotent event identity. External project publishers should do the same after
their own atomic publication by calling `publishOvenDataPublishedEvent` from
`burnlist/oven-events`; consumers still reopen the canonical data.

## Vendoring and pinning an Oven

`burnlist oven adopt <id>` copies the shipped source into the committed
`.burnlist/ovens/<id>/` directory. The vendored directory contains exactly
`<id>.oven`, `instructions.md`, and `pin.json`; it is not the ignored
`.local/burnlist/ovens/` custom-Oven state. A pin records the declared Oven
identity and source revision:

```json
{
  "id": "checklist",
  "version": "0.1.0",
  "revision": "o1-sha256:<hex>",
  "source": "built-in",
  "pinnedAt": "2026-07-21T20:23:35.554Z"
}
```

The declared `id@version` identity is distinct from the content revision: the
revision changes when source bytes change. Because the vendored copy and pin
are committed, upgrading the Burnlist CLI never silently changes a project's
Oven. Run `burnlist oven upgrade <id>` to opt in to copying the shipped source
again, then commit the changed vendored directory. The dashboard resolves a
repo's vendored Oven before the shipped official definition when
`.burnlist/ovens/<id>/` exists; otherwise it uses the catalog-backed shipped
definition. The pin's historical `source: "built-in"` value is an on-disk
compatibility field, not a second membership authority.

## Binding & viewing

`burnlist oven bind <id> <path>` stores the path exactly as supplied. The record
lives at `.local/burnlist/bindings.json` with this schema:

```json
{
  "schemaVersion": 1,
  "bindings": {
    "<id>": {
      "path": "<path>",
      "boundAt": "<iso>"
    }
  }
}
```

A relative path resolves from the repository root when read. Successful binding
prints `Bound Oven <id> to <path>` and `Store: <repo>/.local/burnlist/bindings.json`.
`bindings` prints `<id>  <path>  <boundAt>` per line. `unbind` reports either
`Unbound…` or `No binding exists…`.

The bound file is arbitrary JSON. Its shape must match the Oven's `source=` and
`<bind source=>` RFC 6901 pointers. Generic checklist-theme Ovens do not
validate that payload at creation. A direct `bind` leaves pointers to resolve
when viewed, where missing values render empty or use fallbacks; `set` instead
rejects a missing declared pointer before changing canonical data or binding.

Use `set` for a validated, private snapshot at the canonical path. Use `bind`
when a project-owned producer must keep updating its own file or directory in
place; `bind` records a path and does not copy or validate its current content.

`burnlist oven view <id>` prints the compiled node tree plus a `node / prop /
source` pointer table. It is for inspecting structure, never rendered data.
To render with data, start the dashboard:

```sh
burnlist --scan-root <repo>
```

The server is loopback-only and normally opens at `http://127.0.0.1:4510/`; add
`--auto-port` to select a free port. A bound custom Oven appears in the index as
a **Custom Oven** with status **Oven**. Clicking it opens
`/r/<key>/o/<id>` and renders it through the shared engine using
the bound JSON. An unbound custom Oven is authored but does not appear there.

For a one-dashboard-session alternative that does not write `bindings.json`,
launch with:

```sh
burnlist --scan-root <repo> --oven-data <id>=<path>
```

This read-only payload binding also makes the custom Oven appear and render.

## End-to-end generic Oven

This complete sequence creates and views the `deploy-status` example in
`references/creating-ovens.md`:

```sh
cd <repo>                                   # a git repo
burnlist init                               # ignore .local/, register root
# author kpi.oven (generic checklist-theme Oven) and instr.md, then:
burnlist oven create deploy-status --instructions instr.md --oven kpi.oven
burnlist oven set deploy-status deploy-data.json
burnlist oven bindings                       # confirm the binding
burnlist oven view deploy-status             # structure only
burnlist --scan-root <repo>                  # dashboard; open the "Custom Oven" row
```

## DSL structure and binding contract

The DSL reference in `references/creating-ovens.md` defines allowed elements,
attributes, and bindings. A `.oven` source or binding is a JSON-pointer into one
read-only data document an adapter produces at view time. The adapter is not
part of the Oven, so author and adapter must agree on the document shape. Record
that expected shape in `instructions.md`, for example in a `## State Contract`
section. For choosing what an Oven should measure and a runnable adapter that
computes it, see [Designing Ovens](designing-ovens.md); to cite an Oven number
as a Burnlist item's proof, see the Proof Authority guidance in
[Burnlist Creation](burnlist-creation.md).

Rich official Ovens instead use a renderer-defined, versioned normalized-data
contract. Differential Testing uses `burnlist-differential-testing-data@1` and
has a packaged adapter SDK for refresh, locking, and atomic publishing; projects
retain evidence authority. See `references/differential-testing-adapter-sdk.md`.

## Worked Example: `loop-status`

An Oven that observes the role-separated execution loop for one Burnlist item.
Its `.oven` source reads the `/loop/*` document the orchestrator adapter serves:

```xml
<oven id="loop-status" version="0.1.0" contract="checklist-progress@1" theme="checklist">
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

The adapter document those pointers read:

```json
{
  "loop": {
    "profile": "L3 deep",
    "role": "Luna",
    "backend": "claude",
    "rounds": 2,
    "lanes": ["contract/compatibility — pass", "resilience/security — pass", "performance/resources — running", "visual/interaction — pass", "integration/regression — fail"],
    "defects": ["2026-07-10T01:12:03+02:00 integration/regression: session rotation drops CSRF token"]
  }
}
```

The Oven only reads this. Loop policy lives in the orchestrator, not the Oven.

## Boundaries

An Oven, and this CLI, may not execute instructions, produce project data, own
canonical project state, mutate Burnlists, import UI code, or start an agent.
Custom Ovens are local and affect only future Runs.
