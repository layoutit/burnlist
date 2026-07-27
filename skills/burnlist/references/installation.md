# Agent Skill and Hook Installation

Burnlist offers two independent integrations. The **skill** tells an agent how to create and execute Burnlists. The **hooks** capture editing activity for Streaming Diff and publish observational native-agent activity for an active Loop. Installing one does not install, require, or remove the other.

## Skill Discovery

The skills CLI surface is:

```sh
burnlist install [--global] [--agent codex,claude] [--dry-run] [--commit] [--force]
burnlist uninstall [--global] [--agent codex,claude] [--dry-run] [--purge]
```

By default, `burnlist install` registers the bundled Burnlist skill for both agents in the current repository:

| Agent | Per-repository target | Global target (`--global`) |
| --- | --- | --- |
| Claude Code | `<repo>/.claude/skills/burnlist` | `~/.claude/skills/burnlist` |
| Codex | `<repo>/.agents/skills/burnlist` | `~/.agents/skills/burnlist` |

The default per-repository mode is a managed symlink and adds its target to `.git/info/exclude`, so it stays local and untracked. `--global` creates the managed global registrations instead. A global npm installation of Burnlist automatically registers those global skills for both agents and starts one persistent shared loopback observer. The service observes only the launch repository plus explicitly registered roots, writes its discoverable runtime under `~/.burnlist/server.json`, and is automatically restored by `burnlist` or `burnlist -i` if it is not healthy. A repository-local installation does not leave a service behind: `burnlist -i` starts an ephemeral observer and stops it when the terminal UI exits. Pass `--local` to force that behavior from a global installation, or `--server <url>` to use an explicitly managed server. `--commit` is per-repository only: it creates a portable managed copy and removes Burnlist's local exclusion entry so the copy can be added to Git. `--force` permits an untracked managed copy to be downgraded to a symlink; tracked copies must be removed through Git first. `--agent codex`, `--agent claude`, or `--agent codex,claude` limits registrations; without it, both agents are targeted. `--dry-run` prints the planned link or copy operations without writing.

Codex uses the shared `~/.agents/skills` target. An older manually installed
`~/.codex/skills/burnlist` can shadow that registration in some clients. If
both exist, compare them before a Loop trial and remove or rename only the
stale manual copy; Burnlist never overwrites that foreign directory.

For a Git worktree, the command reports the default mode as `untracked (local, .git/info/exclude)`. For `--commit`, it checks copied content files and reports either `committable (portable copy; run git add to track)` or the actual ignore rule still hiding content. Global registrations report `global symlink (no repo exclude)`. A non-Git directory instead reports `symlink (no git repo to exclude into)` or `portable copy (no git repo)`.

`burnlist uninstall` removes only Burnlist-managed registrations in the matching scope and removes its matching local exclusion entries. `--purge` requires `uninstall --global`, targets both agents, and also uninstalls the global npm package.

## Native Observability Hooks

The hooks CLI surface is:

```sh
burnlist hooks [install|uninstall|status] [--agent codex,claude] [--untracked]
```

Bare `burnlist hooks` defaults to `status`.

The current installer supports Codex and Claude only. Grok and Antigravity
launch requirements live in their `loop-providers/` recipes; do not hand-write
their hook configs or claim exact external Loop attribution from the planned
Agent Monitor design.

`burnlist hooks install` is repository-only and must run inside a Git worktree; there is no `--global` flag. It adds managed Streaming Diff commands plus advisory `burnlist hooks observe` commands while preserving unrelated hook entries:

| Agent that consumes the hook | Config written at the worktree root | Observed events |
| --- | --- | --- |
| Codex | `<repo>/.codex/hooks.json` | `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop` |
| Claude Code | `<repo>/.claude/settings.json` | Codex events plus `PostToolUseFailure` |

Streaming Diff entries remain limited to each agent's write/edit tools. The
advisory observation entries retain only bounded lifecycle, hashed
session/agent identity, tool name, contained file paths, timing, model, effort,
and token usage when the native payload exposes them. They publish to ignored
local Oven event state and cannot report a semantic outcome or advance a Loop.
An exact native `PreToolUse` for `burnlist loop next|claim` prepares a
short-lived hashed session/tool/Run tuple. The matching native `PostToolUse`
may bind that session only after the exact Run's claim is durable; no invented
payload field or singleton process-of-elimination is accepted. An unmatched
session is ignored even when one claim is live.
Codex hook support requires Codex CLI 0.124.0 or newer; `status` reports whether
the installed CLI can run the configured hooks. The commands require
`burnlist` on the host `PATH`; each agent may still ask for hook trust or
consent.

By default, an untracked hook config is added to `.git/info/exclude`, making it local. A tracked config remains shared with the team. `--untracked` asks install to add the config to that local exclude file even when it is tracked, but Git cannot hide an already tracked file. Burnlist records only configs it created under `<repo>/.local/burnlist/` so uninstall can remove an otherwise-empty created config; it removes only its exact hook entries and leaves unrelated configuration intact.

Use `burnlist hooks status` to report each selected agent's hook state, whether its config is tracked or local, and CLI capability. `burnlist hooks uninstall` removes Burnlist's managed hook entries and its matching local-exclude entry. Both default to Codex and Claude; use `--agent codex`, `--agent claude`, or `--agent codex,claude` to limit the operation.

The status output uses hook states `installed`, `none`, `partial`, or `corrupt`; it labels configuration as `shared with the team; info/exclude cannot hide tracked config`, `local (listed in .git/info/exclude)`, or `local (not listed in .git/info/exclude)`, and shows the config path inspected. Capability output is labeled by CLI (`codex cli:` or `claude cli:`) and is `installed+hooks-supported`, `installed-but-hooks-unsupported` (including the required minimum), or `not-installed`.

## Common Commands

Run these from the repository for per-repository integrations:

```sh
# Skill only
burnlist install

# Hooks only
burnlist hooks install

# Both systems
burnlist install && burnlist hooks install

# Global skill only (hooks have no global mode)
burnlist install --global

# Global skill plus this repository's hooks
burnlist install --global && burnlist hooks install

# Inspect or explicitly control the shared global observer
burnlist service status
burnlist service restart

# Force one ephemeral observer for this TUI session
burnlist -i --local

# Remove the per-repository skill only
burnlist uninstall

# Remove the hooks only
burnlist hooks uninstall

# Remove both per-repository systems
burnlist uninstall && burnlist hooks uninstall

# Remove global skill registrations; add --purge to also uninstall global npm Burnlist
burnlist uninstall --global
burnlist uninstall --global --purge
```
