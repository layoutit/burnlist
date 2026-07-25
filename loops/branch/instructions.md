## plan
Turn the assigned item into a concise execution plan of independent subtasks.
Choose N from the work itself; prefer the fewest branches that create useful
parallelism. Define branch boundaries, shared constraints, and merge criteria.

Do not edit Burnlist lifecycle files or complete the item directly.

## branches
Execute the prepared independent subtasks through N smaller, faster agents when
the host supports subagents. Give each agent its exact slice and acceptance
criteria. Keep writes disjoint where possible. If native subagents are
unavailable, execute the same slices sequentially without changing the Loop
contract. Return only after every branch has a concrete result.

## merge
Combine all branch results into one coherent candidate. Resolve overlaps,
finish integration work, and run focused checks before repository validation.

## review
Independently review the merged, validated candidate against the original item
and plan. Approve when integration is coherent. Escalate P0 safety, security,
data-loss, or authority blockers; reject P1 defects and P2 defects that
materially affect acceptance back to planning. Keep P3 refinements as
non-blocking follow-ups and omit noisy P4 preferences.
