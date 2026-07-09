# Burnlist Visible Output

Read this reference when Burnlist chat verbosity, compaction behavior, or output discipline is the problem.

## Principle

Do not reduce reasoning depth. Reduce visible narration. Visible chat is not a transaction log, scratchpad, or working memory stream.

Use internal reasoning, tool results, tests, `burnlist.md`, `completed.md`, `scratch.md`, and the dashboard as working-state channels. The user should see the dashboard move and only get chat when there is a decision, blocker, real scope change, split decision, completed atomic result, or handoff.

## Burn Transaction Silence

Once validation passes and a burn transaction starts, do not send visible chat until the transaction has completed, failed, or revealed a real split/blocker/scope decision.

Do not narrate:

- intent to burn
- ledger updates
- active-list starts
- `completed.md` updates
- timestamp generation
- protocol-check starts
- routine reads/searches/edits/tests
- raw hypotheses
- "need/could/maybe" chains
- instruction rereads

Forbidden examples:

```text
B2 proof is good. I'm recording B2 as burned now...
I'm updating the Burnlist ledger and compact completion history...
The active list now starts at B3...
B2 is recorded. I'm running the Burnlist checker...
Checked both updated skills.
Key takeaways I'll apply now:
```

If global update pressure conflicts with a normal burn transaction, finish the short critical section first. If a higher-priority rule forces an update, send exactly:

```text
Burning B13 atomically; next visible update after the check or blocker.
```

Do not customize that line with proof status, ledger details, active-list details, `completed.md`, timestamp, checker, or next-item narration.

## Checkpoint Gate

Before sending any Burnlist update, ask whether the user needs to decide or steer; the active item split, blocked, widened, narrowed, or became invalid; validation changed the next action; or an item is complete/deleted/final handoff.

If none apply, send nothing.

For one active item, default to at most three chat checkpoints:

1. target chosen
2. blocker/split/scope change if it happens
3. completion/delete/handoff

When a checkpoint is needed, write one concise normal paragraph answering what changed, why it matters, and what happens next.

## Compaction

After compaction or context refresh, never summarize skill instructions back to the user unless explicitly asked to explain the skill. If guidance is missing or uncertain, reread or refresh it silently, then continue from the active item.

Do not narrate compliance or instruction rereads unless they change the current decision.
