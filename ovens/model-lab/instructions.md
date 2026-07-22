# Model Lab

Inspect one prepared PolyCSS model through the product's real mount path while retaining the exact prepared frameset, leaf topology, material publication, and provenance.

## Outcome

The live surface mounts one prepared model without runtime parsing, geometry construction, topology construction, material construction, asset construction, or LOD substitution. Frame changes update styles on the same DOM root and leaves.

## Data Shape

- Input mode: `json-payload`.
- Runtime validator: `validateModelLabRuntimeData`.
- Starter data: none.

The runtime validator is the authority used by both `oven set` and the render
handler. It requires a `burnlist-model-lab-data@1` document with `generatedAt`,
`project`, loopback `surface`, prepared `model`, and hash-bound `evidence`, plus
an optional reconciled `comparison`. There is no `example/data.json`, so `oven
use model-lab` adopts without data.

## State Contract

The bound document uses `burnlist-model-lab-data@1`. It identifies one loopback-hosted live surface, one prepared frameset, its selected frame, its stable topology hashes, the single `<s>` leaf tag, `lodCount: 1`, zero runtime construction counters, and manifest/render-publication SHA-256 evidence.

The live surface may publish `polycss-model-lab-state@1` messages to the controlled renderer. Those messages are observational runtime evidence; they never replace the bound prepared-state document.

## Run Inputs

- A prepared product manifest and render publication.
- The model id and selected frame index.
- A loopback URL that mounts the model through the product runtime.
- A project adapter that atomically publishes the normalized document.

## Evidence

- The iframe visibly renders the product surface, not a reconstructed preview.
- Every prepared leaf uses `<s>` and the live leaf count matches the frameset leaf count.
- Frame swaps preserve root and leaf identities and produce zero child-list mutations.
- All runtime construction counters remain zero.
- `lodCount` is exactly `1`; this Oven does not compare or select LODs.
- Manifest, render publication, topology, and frameset hashes bind the observation to prepared artifacts.

## Failure Rules

Malformed, remote, stale, incomplete, or contradictory bindings are blocked. A visually coherent model is a separate product judgment: structural metrics alone do not prove that texture crops or source-facing selection are correct.
