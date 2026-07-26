# Operational UX Contract

Read this reference when choosing controls for an item, explaining live state,
optimizing routine execution, handling review priority, or proving a task-fit
Oven visually. It is guidance, not project architecture.

## The shortest useful model

- A **Burnlist** is the canonical queue and completion ledger: what remains and
  what evidence allowed an item to burn.
- A **Loop** is an optional, frozen execution and decision graph for one item:
  who acts, which trusted check runs, whether independent review is required,
  and which outcomes are legal.
- An **Oven** is a declarative, read-only view over real producer data: whether
  the user-approved outcome is moving.
- A **check** executes one explicitly trusted repository capability. A
  **convergence gate** evaluates the check/review evidence already recorded by
  the Run. Neither is inferred from hooks or an agent statement.

Burnlist coordinates these contracts softly. The repository still owns its
architecture, implementation strategy, tests, UI or domain tools, deploy
rules, and proof authority.

## Coarse to fine by default

For early implementation, prefer this sequence:

1. Establish the thinnest end-to-end path that reaches the real outcome.
2. Prove that path with the declared repository check and, when useful, a
   user-approved Oven signal.
3. Refine internal layers, edge cases, performance, and polish without
   replacing the working vertical slice.

This is a default, not a command to restructure the project. Follow an
existing repository plan or user-selected architecture when it says
otherwise.

## Optional per-item recommendation

Use `burnlist recommend <id>#<item> [--repo <path>]` for one deterministic,
advisory recommendation. `--json` emits
`burnlist-operational-recommendation@1`. The user may accept, change, or ignore
it.

The recommendation chooses the lightest fitting control:

| Item shape | Typical Loop | Model class / effort |
| --- | --- | --- |
| Small docs or low-risk direct change | direct | fast / low |
| Bounded implementation with a trusted check | gate | standard / medium |
| Security, data, public-contract, concurrency, or production risk | review | strong / high or xhigh |
| Genuinely independent work streams with integration risk | branch | strong / high |

Model class is provider-neutral. The host chooses an available model and
remains responsible for invocation. A recommendation never installs, selects,
authenticates, or launches a provider.

Metrics are also advisory. Prefer objective, user-approved signals:

- UI or visual work: Visual Parity screenshots and explained pixel drift.
- Reference/candidate or migration work: Differential Testing.
- Performance work: Performance Tracing against a real baseline and budget.
- Model/geometry work: Model Lab against its declared model contract.
- Everything else: the trusted repository check may be enough.

Do not add an Oven merely to produce a number. A hand-entered metric, an
unapproved proxy, or a compile-only screenshot is not outcome evidence.

## P0-P4 review handling

Review severity controls whether completion may proceed:

| Priority | Finding severity | Handling |
| --- | --- | --- |
| P0 | `blocker` | Stop and escalate safety, security, data-loss, or invalid-authority risk. |
| P1 | `major` | Reject a high-impact correctness or contract defect. |
| P2 | `major` when material | Reject when acceptance or a material user outcome is affected. |
| P3 | `minor` | Do not block; record one bounded follow-up when useful. |
| P4 | `note` | Optional style or preference note; omit noise. |

An approval cannot leave P0/P1 or material P2 findings open. A gate consumes
canonical check/review evidence; recent activity, forecasts, and agent
confidence never satisfy it.

## Truthful live item state

The vanilla Checklist uses exactly these labels:

- `PENDING`: no canonical Run or claim exists. Checklist position does not
  imply execution.
- `ACTIVE`: the canonical Run is executing a deterministic node or has a live
  host claim.
- `WAITING`: a Run exists but awaits a host task, resume, or atomic Burnlist
  completion.
- `BLOCKED`: canonical Run state needs human action, failed, stopped, exhausted
  its budget, or cannot be projected safely.
- `COMPLETED`: the canonical Burnlist completed ledger records the item.

Bounded, invocation-correlated hooks may refine `ACTIVE` to **progressing** and
show recent agent/model/effort, tools, paths, timing, and available usage. They
never create `ACTIVE`, choose an outcome, satisfy a gate, or complete an item.

Every live surface must name provenance:

- canonical: Burnlist lifecycle, queue/ledger, assignment, Run/node/claim,
  transitions, checks, gates, reviews, budgets, blockers, and retries;
- observational: hook activity, exposed agent/model/effort, paths, timings,
  and reported token usage;
- forecast: bounded prior or local history with confidence and sample counts.

Missing facts remain `Unavailable`.

## Visually verify every task-fit Oven

After creating, adopting, or changing an Oven used as task proof:

1. Publish real or explicit fixture data through the source-owned producer.
2. Open its canonical dashboard URL.
3. Inspect the rendered desktop and narrow/mobile layouts.
4. Exercise relevant empty, waiting, blocked, stale, error, and completed
   states.
5. Confirm labels, values, overflow, hierarchy, and provenance are readable.
6. Record the user-approved signal in the Burnlist item's proof contract.

Use browser evidence for this inspection. Passing compilation or DOM tests
alone is insufficient. The dashboard stays read-only and the Oven remains
declarative.

## Optimize observed cost, not invented cost

For comparable items and trials, record only available facts:

- host-visible commands;
- agent turns;
- wall time;
- reported input/output tokens;
- check and review retries;
- forecast error.

Prefer fewer commands and handoffs when authority stays intact. Reuse
`loop next`/`submit`, event-driven refresh, canonical dashboard URLs, and
bounded projections. Never invent token usage, dollar cost, model identity, or
progress from silence.
