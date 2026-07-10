# Compare Data Contract

Projects feed the built-in Compare Oven with one JSON document using schema `burnlist-compare-data@1`. The project owns capture and transformation. Burnlist validates and renders the normalized result without importing project code.

Use the packaged validator before starting the dashboard:

```sh
burnlist compare validate /absolute/path/to/compare.json
burnlist --oven-data compare=/absolute/path/to/compare.json
```

The structural JSON Schema is in `skills/burnlist/contracts/compare-data.schema.json`. The CLI validator is authoritative because it also recomputes relationships that JSON Schema cannot express.

## Sample Tuple

Every field contains an ordered `samples` array. Each tuple is:

```json
[42, 10.5, 10.75, 1]
```

The positions are `tick`, `reference`, `candidate`, and `state`. Tick identity must increase strictly and match every other field exactly. Values must be JSON scalars or null.

States are:

- `0`: values match under the field tolerance
- `1`: both values exist and do not match
- `2`: reference is missing; its tuple value must be null
- `3`: candidate is missing; its tuple value must be null
- `4`: both are missing; both tuple values must be null

Null is a value when state is `0` or `1`. Missing is represented only by states `2`, `3`, and `4`. This prevents null from being silently converted to numeric zero.

## Reconciliation

The validator independently recomputes:

- strict tick ordering and exact tick identity across fields
- match or mismatch state from values and tolerance
- failed, missing, and first non-pass sample metadata
- maximum delta from present values
- field, frame, and run summary partitions
- progress chronology and reverse log chronology
- top-level trust from blocked rows or missing samples

`failedSampleCount` counts state `1`. `missingSampleCount` counts states `2` through `4`. Summary totals are partitions: `total` must equal `passed + failed + blocked`.

A blocked payload must contain at least one human-readable blocker. It may retain valid partial field rows for diagnosis, or publish no rows when the source artifact is too untrusted to normalize. An unavailable blocked payload may declare expected fields as blocked, but it cannot claim passed or failed fields.

## Adapter Boundary

An adapter must:

1. Name a stable adapter id and preserve artifact provenance.
2. Align by real sample identity, never by array position alone.
3. Preserve reference and candidate roles.
4. Declare the semantic owner, meaning, unit, and tolerance of every field.
5. Emit a blocked payload when capture or normalization is incomplete.
6. Write atomically so the dashboard never reads a partial file.

The neutral example in `skills/burnlist/examples/compare/adapter.mjs` demonstrates the complete boundary. It consumes two small capture files and emits one validated payload.
