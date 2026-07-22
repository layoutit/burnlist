# Oven Contract

This is the normative definition of an Oven.

An Oven is a named, declarative recipe for a Burn. It consists of bounded Markdown instructions in `instructions.md` and a declarative, non-executable `<id>.oven` DSL source. The instructions define the outcome, canonical state, required run inputs, and evidence rules. The source defines how normalized data may be presented.

An Oven does not:

- execute commands or code
- collect or transform project data
- own or replace canonical project state
- mutate Burnlists or other project files
- import arbitrary UI components
- start Codex

A project-specific adapter may produce normalized data, but that adapter is not part of the Oven. A `.oven` binding uses a JSON-pointer-like source beginning with `/`. Source-value shape is outside creation-time validation. At `oven set` time, a built-in uses its render handler's runtime validator; a custom Oven without one receives pointer-presence validation with an explicit `shape-only` warning. Shape validation never proves payload truth.

## Package

An Oven directory is identified by a lowercase slug and contains these two canonical files:

```text
<oven-id>/
  instructions.md
  <id>.oven
```

`instructions.md` must be non-empty and contain a level-one heading. The heading is the Oven name. The remaining Markdown stays flexible; section headings are guidance, not a machine-enforced language.

`<id>.oven` is a declarative, versioned, non-executable DSL source validated by the Oven grammar through `compileOven`. It cannot define or execute HTML, JavaScript, CSS, shell commands, or component imports. Its IR is build-generated and never committed.

An Oven's identity revision is `o1-sha256` over canonical JSON `{format:"burnlist-oven-content@2", id, instructions, oven}`. `detail.json` is retired from the data model and survives only in a read-only legacy path for old detail-based run snapshots.

An optional `example/data.json` may sit beside a shipped Oven for `oven use`,
and a JSON Schema may sit beside implementation files as human/agent reference
documentation. Neither is canonical package content, neither is vendored, and
neither enters the identity revision or pin. JSON Schema is never the runtime
validation authority.

Official Ovens are the shipped definitions named by `ovens/catalog.json`. Custom Ovens are created under ignored `.local/burnlist/ovens/` state. The dashboard has no update endpoint, but the `burnlist oven` CLI can create, update, fork, list, view, use, set, bind, unbind, and show bindings; official Ovens stay read-only there. `set` publishes only to ignored `.local/burnlist/data/<id>.json` after validation and preserves a prior valid install on failure. Manual source changes affect only future Runs. An official handler may define and validate a versioned normalized-data contract; Differential Testing uses `burnlist-differential-testing-data@1`. For the controlled DSL vocabulary and source-binding conventions, see `creating-ovens.md`.

## Official Catalog and Evidence

`ovens/catalog.json` is the versioned, non-executable source of official Oven
membership. It records each shipped id, version, normalized-data contract,
input mode, source-owned producer, route kind, maturity, and acceptance state.
It is metadata about Ovens and is not itself an Oven. An unlisted package,
registered handler, custom Oven, vendored Oven, demo, or screenshot is not
official. `GET /api/oven-catalog` exposes this validated set;
`GET /api/ovens` is separate availability inventory with explicit `official`,
`vendored`, or `custom` origins.

Evidence uses four disjoint classes:

- `unit-fixture` proves a bounded parser, validator, or renderer mechanic.
- `transport-fixture` proves bounded event, cache, conditional-request,
  reconnect, or fallback mechanics.
- `catalog-route` proves the production `/ovens` catalog page and exact official
  set. It does not qualify an Oven.
- `canonical-oven` is the only class that may satisfy an official entry's
  acceptance state.

Canonical Oven evidence must bind the current catalog revision, matching Oven
id/version/revision and named producer, repository key, real bound-data digest,
canonical `/r/.../o/<id>` route, exact production script and stylesheet hashes,
and retained screenshot and network artifacts. It must declare
`sourceKind: "canonical-producer"` and `fixture: false`. Fixture servers,
placeholder images, synthetic payloads, mock screenshots, catalog-page
captures, counts, topology checks, and green builds cannot substitute for that
proof. Missing proof is `unverified` or `blocked`, never inferred acceptance.

Validate a retained evidence bundle against the installed catalog with:

```sh
node scripts/verify-official-oven-evidence.mjs <evidence.json>
```

## Run Boundary

`Run Burn` records a repository, title, and objective, then copies the selected `instructions.md` and `<id>.oven` into a new ignored `.local/burnlist/runs/` directory. That snapshot is immutable run provenance; the app does not execute it or start Codex.

Oven-specific inputs belong in the objective unless the generic Run contract is deliberately expanded for every Oven. For Differential Testing, the objective names the reference and candidate artifacts, project adapter or report, active scenario and alignment contract, exact comparator when used, and comparable rerun procedure.

The run manifest's `schemaVersion` versions the manifest shape. It is not an Oven revision. The copied Oven files are the authoritative definition used by that Run.

There are no alternate filenames, legacy type routes, or compatibility discovery paths. Invalid or incomplete Oven packages are rejected.
