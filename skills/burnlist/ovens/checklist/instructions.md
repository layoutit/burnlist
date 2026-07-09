# Checklist

Checklist is the default queue-completion Oven. It preserves the current Burnlist Progress behavior, observes a shrinking Markdown checklist, and answers: how much of the work queue has been burned down?

## State Contract

The canonical run state is `burnlist.md` with an ordered `## Active Checklist` and a terse `## Completed` ledger. The dashboard is an observer; it does not replace or silently mutate that state.

## Direction

Progress normally moves from `0%` toward `100%`. Completed count comes from the completed ledger, remaining count comes from the active checklist, and total is completed plus remaining.

## Run Inputs

A Run needs a repository, a concise title, and an objective. Planning and execution remain governed by the Burnlist protocol.

## Evidence

Completion is proven by canonical checklist state and the checks required by each item. Dashboard percentages, charts, and logs are reader views, not implementation proof.

## Detail Page Data

The normalized detail payload may expose `summary`, `active`, `completed`, `timeline`, and `log` fields. Detail-block bindings use JSON-pointer-like source paths and never execute code from these instructions.
