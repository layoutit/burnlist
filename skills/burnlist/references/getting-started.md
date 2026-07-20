# Start Here: Burnlist in Five Minutes

## What Burnlist is

Burnlist is a repo-local, evidence-driven task tracker for AI agents. It has zero runtime dependencies—only Node built-ins on Node >= 18—and provides a `burnlist` CLI plus a read-only observer dashboard. Burnlist owns task state, not implementation: the agent does the work and reports progress back into the Burnlist. Work lives in a shrinking Markdown checklist at `notes/burnlists/<state>/<id>/burnlist.md` and burns down to zero.

## The three concepts

### Burnlist

A Burnlist is your list of work. Each item completes atomically on evidence: burn it once, only when it is really done, then delete it from the active list. The list burns down to zero. It answers: “What do I do next, and is it really done?”

**When to reach for it:** Use a Burnlist when a goal needs explicit steps, proof of completion, and durable task state across agent sessions.

### Oven

An Oven is a read-only dashboard view that renders honest signals over your own data—progress, metrics, and diffs—so you see truth instead of vibes. It answers: “How are we actually doing?”

**When to reach for it:** Use an Oven when success depends on measurable evidence that a checklist alone cannot show. See [Designing Your Oven](designing-ovens.md) for how to choose that evidence.

### Lane

A lane splits one large Burnlist into parallel sub-lists. Independent work streams can then burn down side by side.

**When to reach for it:** Use lanes when one plan has genuinely independent tracks that can proceed in parallel. See [Burnlist Splitting and Lanes](burnlist-splitting-lanes.md) for the mechanics.

## Set up in three steps

1. Install the CLI:

   ```sh
   npm i -g burnlist
   ```

   The npm postinstall automatically registers the Burnlist skill for both agents: Claude Code under `~/.claude/skills` and Codex under `~/.agents/skills`. The skill is available immediately. Alternatively, point any agent at the hosted skill at <https://burnlist.dev/skill.md>. It is a complete, self-contained document and needs no installation.

2. Initialize the repository:

   ```sh
   burnlist init
   ```

   This scaffolds `notes/burnlists/{draft,ready,inprogress,completed}/`, keeps that state locally ignored by Git, and registers the repository so the dashboard can observe it.

3. Create your first Burnlist:

   ```sh
   burnlist new
   ```

   The command prints a new draft id, such as `<YYMMDD-NNN>`, under `notes/burnlists/draft/`. Move it through the lifecycle with:

   ```sh
   burnlist ready <YYMMDD-NNN>
   burnlist start <YYMMDD-NNN>
   burnlist burn <YYMMDD-NNN> <item>
   burnlist close <YYMMDD-NNN>
   ```

   In practice, ask the agent—which now has the skill—to create and harden a Burnlist for a goal. The CLI provides the dashboard and protocol helpers.

## Next

- [Designing Your Oven](designing-ovens.md): choose objective evidence for an honest Oven.
- [Burnlist Creation](burnlist-creation.md): author a rigorous Burnlist.
