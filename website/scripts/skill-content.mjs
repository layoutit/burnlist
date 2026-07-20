/**
 * Builds the content of skill.md — a single, self-contained Burnlist skill
 * document served at the site root (https://burnlist.dev/skill.md) so an
 * agent pointed at that URL has everything it needs: what Burnlist is, how
 * to install it, the full CLI surface, the lifecycle, the five ovens, and a
 * listing of every doc page. Kept accurate to the real CLI help output and
 * the docs it is generated alongside; do not describe behavior the CLI does
 * not have (no loop feature, no componentization, no work execution).
 */

// Fallback used only if the sibling CLI can't be spawned at build time (see
// generate-llms-txt.mjs, which prefers the live `burnlist --help` output).
export const FALLBACK_CLI_HELP = `Burnlist

Usage:
  burnlist [--port <port>] [--scan-root <repo[,repo...]>]
  burnlist --plan <burnlist.md> --check
  burnlist --plan <burnlist.md> --digest
  burnlist --close-completed [--scan-root <repo[,repo...]>]
  burnlist --stamp
  burnlist differential-testing validate <differential-testing.json>
  burnlist differential-testing validate-bundle <bundle/current.json>
  burnlist differential-testing schema
  burnlist differential-testing sdk
  burnlist streaming-diff <ensure-feed|capture|url|hook> ...
  burnlist hooks [install|uninstall|status] [--agent codex,claude] [--untracked] (bare defaults to status)
  burnlist oven <list|view|bind|unbind|bindings|create|update> ...
  burnlist new [--repo <path>]
  burnlist show <id>[#<item>] [--repo <path>]
  burnlist ready <id> [--repo <path>]
  burnlist start <id> [--repo <path>]
  burnlist close <id> [--repo <path>]
  burnlist burn <id> <item> [--check] [--repo <path>]
  burnlist register [path]
  burnlist unregister [path]
  burnlist roots [--prune]
  burnlist init [path] [--track]
  burnlist install [--global] [--commit] [--force] [--agent codex,claude] [--dry-run]
  burnlist uninstall [--global] [--agent codex,claude] [--dry-run] [--purge]

Options:
  --auto-port           Try the next available loopback port.
  --host <host>         Bind host; loopback is required by default.
  --state-dir <path>    Override ignored dashboard observer state.
  --ovens-dir <path>    Override launch-repository custom Oven storage only.
  --runs-dir <path>     Override Run snapshot storage.
  --oven-data <id=path> Bind one Oven to a read-only normalized JSON payload.
  --global              Install or uninstall skills in the user home directory.
  --commit              Per-repository install: copy portable skills for git commit.
  --force               Permit install to replace a Burnlist-managed portable copy with a symlink.
  --agent <agents>      Restrict skill install or uninstall to codex, claude, or both.
  --dry-run             Print skill link or portable-copy plans without writing them.
  --purge               With uninstall --global only, also remove the global npm package.
  --version, -v         Print the installed Burnlist version.
  --help, -h            Show this help.`;

export function buildSkillMarkdown({ documents, siteUrl, cliHelp = FALLBACK_CLI_HELP }) {
  const docLinks = documents.map(({ slug, title }) => `- [${title}](${siteUrl}/docs/${slug}.md)`).join('\n');

  return `# Burnlist skill

> Point an agent at ${siteUrl}/skill.md for a complete, self-contained Burnlist skill: what it is, how to install it, its full CLI surface, its lifecycle, and its five ovens.

## What Burnlist is

Burnlist is a real-time, non-invasive tracker for agents. A Burnlist stores work in a repo-local, shrinking Markdown checklist (\`notes/burnlists/<state>/<id>/burnlist.md\`) and renders live progress in a local, read-only observer dashboard. It has zero runtime dependencies (pure Node built-ins, ES modules, Node >= 18).

Burnlist owns task state — not implementation, testing, or delivery. **It does not execute your work or drive your agents.** It is built for planning and observing an agent's work; the agent (or a domain-specific skill) does the actual work, and reports progress back into the Burnlist.

## The three concepts

- **Burnlist** — your list of work. Items complete atomically on evidence and leave the active list only once truly done; the list burns down to zero. It answers "what do I do next, and is it really done?"
- **Oven** — a read-only dashboard view that renders honest signals over your own data (progress, metrics, diffs) so you see truth, not vibes. It answers "how are we actually doing?"
- **Lane** — a split of one large Burnlist into parallel sub-lists so independent tracks burn down side by side. Reach for it when a plan has genuinely independent work streams.

## Install

Install and hooks are independent steps — installing one does not install the other.

### 1. Install the CLI

\`\`\`sh
npm install --global burnlist
\`\`\`

Installs the \`burnlist\` command. Its npm \`postinstall\` step also registers the bundled agent skill globally (Claude Code under \`~/.claude/skills\`, Codex under \`~/.agents/skills\`) so the skill is available immediately.

### 2. (Reinstall or customize) the agent skill

\`\`\`sh
burnlist install [--global] [--commit] [--force] [--agent codex,claude] [--dry-run]
\`\`\`

Without \`--global\`, this registers the skill for the current repository only (an untracked local link by default, or a portable copy for git with \`--commit\`). With \`--global\`, it (re)registers the skill in the user's home directory, same as the npm postinstall step. \`--agent codex,claude\` restricts which agent(s) get the skill; \`--dry-run\` prints the plan without writing.

### 3. Install Streaming Diff hooks (optional, separate feature)

\`\`\`sh
burnlist hooks install --agent codex,claude
burnlist hooks status
burnlist hooks uninstall --agent codex,claude
\`\`\`

Merges local Streaming Diff commands into \`.codex/hooks.json\` and/or \`.claude/settings.json\`, preserving existing entries. This is unrelated to the skill install above; installing the skill does not install hooks, and installing hooks does not install the skill.

### Uninstall

\`\`\`sh
burnlist uninstall [--global] [--agent codex,claude] [--dry-run] [--purge]
\`\`\`

\`--purge\` (global only) also removes the global npm package.

## Designing an Oven: measure what you can't fake

An Oven makes progress objective so an agent cannot fool itself — the antidote to "I think it's done." For your problem, ask: **what signal proves this is working, that I cannot fake or hand-wave?** Then measure proxy-resistant evidence, not self-report.

| Self-reported and gameable | Objective and verifiable |
| --- | --- |
| "~80% done" | "142/200 tests pass" |
| "looks good" | "3 byte-diffs remain" or "0 pixel drift" |
| "should work" | "1,240/1,500 rows migrated and validated" |

The built-in ovens embody this: Differential Testing measures byte-identical goldens, Visual Parity measures pixel diffs, Streaming Diff captures real pre-to-post diffs, and Performance Tracing measures real timings against a budget — never self-assessment. Map your signals onto the view vocabulary — headline numbers to a kpi-strip, the event stream to a log-table, the burn-down to a progress-donut — and compute the real values in a project-owned data adapter that emits one read-only JSON document the Oven binds to. If a number can be typed by hand without doing the work, it is not evidence.

## CLI surface

Authoritative output of \`burnlist --help\`:

\`\`\`text
${cliHelp}
\`\`\`

## Lifecycle

A Burnlist's state is its location. The whole folder moves through four lifecycle directories, and each item burns down through five verbs, in order:

| Verb | CLI command | Meaning |
| --- | --- | --- |
| new | \`burnlist new\` | Create a draft Burnlist. |
| ready | \`burnlist ready <id>\` | Mark a plan ready. |
| start | \`burnlist start <id>\` | Move ready to inprogress. |
| burn | \`burnlist burn <id> <item>\` | Complete one active item. |
| close | \`burnlist close <id>\` | Close a completed Burnlist. |

Folders: \`notes/burnlists/{draft,ready,inprogress,completed}/<YYMMDD-NNN>/\`. \`goal.md\` is the stable contract (Goal, Guardrails, Proof Authority, Ordering Intent, Stop Conditions, Handoff); \`burnlist.md\` is the hot, shrinking task state (an ordered Active Checklist and a terse Completed ledger); \`completed.md\` is optional durable per-burn history for humans. Run \`burnlist --plan <burnlist.md> --check\` to validate and \`burnlist --stamp\` to generate the mechanical timestamp used in a completion ledger line.

## The five ovens

An Oven is a named, declarative, non-executable recipe for a Burn — data, never code. Five built-in, read-only ovens ship with Burnlist:

- **Checklist** tracks the active work queue and progress.
- **Differential Testing** provides aligned reference-versus-candidate series, optional aggregate telemetry, and exact-first evidence.
- **Streaming Diff** surfaces recently published, session-scoped pre-to-post diff cards read from a local feed.
- **Performance Tracing** renders retained browser-output timing evidence — frame pacing, budget checks, and slow steps — from a project-owned trace run.
- **Visual Parity** compares trusted reference and candidate frames as isolated render passes, gating each render domain on calibrated channel, mean-delta, and changed-pixel bounds.

Author and inspect ovens with \`burnlist oven <list|view|bind|unbind|bindings|create|update|fork>\`. Custom ovens live in ignored, repo-scoped \`.local/burnlist/ovens/\` state.

## Documentation

${docLinks}

## Source

- GitHub: https://github.com/layoutit/burnlist
- License: MIT
`;
}
