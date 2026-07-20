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

A project-specific adapter may produce normalized data, but that adapter is not part of the Oven. A `.oven` binding uses a JSON-pointer-like source beginning with `/`. Source-value shape is outside creation-time validation; the consuming adapter or renderer owns that check when data is available.

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

Default Ovens ship with the skill. Custom Ovens are created once under ignored `.local/burnlist/ovens/` state. The dashboard has no update endpoint, but the `burnlist oven` CLI can create, update, view, and list custom Ovens under the same validation; built-in Ovens stay read-only there. Manual changes affect only future Runs. A built-in renderer may define and validate a versioned normalized-data contract; Differential Testing uses `burnlist-differential-testing-data@1`. For the controlled DSL vocabulary and source-binding conventions, see `creating-ovens.md`.

## Run Boundary

`Run Burn` records a repository, title, and objective, then copies the selected `instructions.md` and `<id>.oven` into a new ignored `.local/burnlist/runs/` directory. That snapshot is immutable run provenance; the app does not execute it or start Codex.

Oven-specific inputs belong in the objective unless the generic Run contract is deliberately expanded for every Oven. For Differential Testing, the objective names the reference and candidate artifacts, project adapter or report, active scenario and alignment contract, exact comparator when used, and comparable rerun procedure.

The run manifest's `schemaVersion` versions the manifest shape. It is not an Oven revision. The copied Oven files are the authoritative definition used by that Run.

There are no alternate filenames, legacy type routes, or compatibility discovery paths. Invalid or incomplete Oven packages are rejected.
