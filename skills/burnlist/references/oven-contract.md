# Oven Contract

This is the normative definition of an Oven.

An Oven is a named, declarative recipe for a Burn. It consists of bounded Markdown instructions in `instructions.md` and a non-executable detail-page skeleton in `detail.json`. The instructions define the outcome, canonical state, required run inputs, and evidence rules. The detail skeleton defines how normalized data may be presented with controlled widgets.

An Oven does not:

- execute commands or code
- collect or transform project data
- own or replace canonical project state
- mutate Burnlists or other project files
- import arbitrary UI components
- start Codex

A project-specific adapter may produce normalized data for the detail skeleton, but that adapter is not part of the Oven. An unbound detail section has an empty `source`; a bound section uses a JSON-pointer-like source beginning with `/`. Source-value shape is outside creation-time validation; the consuming adapter or renderer owns that check when data is available.

## Package

An Oven directory is identified by a lowercase slug and contains these two canonical files:

```text
<oven-id>/
  instructions.md
  detail.json
```

`instructions.md` must be non-empty and contain a level-one heading. The heading is the Oven name. The remaining Markdown stays flexible; section headings are guidance, not a machine-enforced language.

`detail.json` is a bounded, versioned data document. Its grid dimensions, section count, section ids, controlled widget and format names, optional sources, bounds, and overlap rules are validated. It cannot define or execute HTML, JavaScript, CSS, shell commands, or component imports.

Default Ovens ship with the skill. Custom Ovens are created once under ignored `.local/burnlist/ovens/` state. There is no dashboard update endpoint. Manual changes affect only future Runs. A built-in renderer may define and validate a versioned normalized-data contract; Differential Testing uses `burnlist-differential-testing-data@1`.

## Run Boundary

`Run Burn` records a repository, title, and objective, then copies the selected `instructions.md` and `detail.json` into a new ignored `.local/burnlist/runs/` directory. That snapshot is immutable run provenance; the app does not execute it or start Codex.

Oven-specific inputs belong in the objective unless the generic Run contract is deliberately expanded for every Oven. For Differential Testing, the objective names the reference and candidate artifacts, project adapter or report, active scenario and alignment contract, exact comparator when used, and comparable rerun procedure.

The run manifest's `schemaVersion` versions the manifest shape. It is not an Oven revision. The copied Oven files are the authoritative definition used by that Run.

## Compatibility

`definition.md`, `dashboard.json`, and the legacy type API are read-only compatibility aliases. New Ovens and Runs use only the canonical Oven names and files above.
