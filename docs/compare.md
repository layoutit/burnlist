# Compare

Compare is the default Oven for source-versus-candidate convergence work. It applies one trusted data and presentation contract to aligned frames, ticks, samples, fields, or state rows.

## State Model

Compare reads project-owned reference captures, candidate captures, comparison reports, and append-only run history through a normalized `burnlist-compare-data@1` payload. The dashboard is a read-only renderer over that payload.

## Question

```text
Where does the candidate first diverge from the trusted reference?
```

## Trust

A Compare result is actionable only when the reference and candidate use the same scenario, inputs, timing mode, alignment key, field semantics, units, and tolerance policy. Missing and null values remain distinct from numeric zero, and summary counts must reconcile with the displayed field rows and samples.

When those conditions fail, fix the capture, adapter, or comparator before changing runtime behavior.

## Source-Backed Discipline

Compare keeps the convergence rules that prevent false progress:

- start at the earliest trusted divergence
- trace upstream to the first source-owned actionable producer
- make at most one narrow source-backed change per cycle
- rerun the same comparable scenario
- revert exactly a change that worsens the result or trust state
- never count threshold loosening, hidden failures, fabricated values, or truncated samples as improvement

Project-specific captures, comparators, and adapters remain in the project. The Oven defines their evidence and presentation contract; it does not execute them.

## Relationship To Checklist

Checklist tracks queue completion. Compare tracks whether a candidate matches a trusted reference. Either can advance independently of the other.

## Default Oven

Compare ships under `skills/burnlist/ovens/compare/` with `instructions.md` and a non-executable `detail.json` skeleton. It follows `skills/burnlist/references/oven-contract.md` and accepts data documented in `skills/burnlist/references/compare-data.md`.
