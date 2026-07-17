# Agent Skill and Hook Installation

Burnlist offers two independent integrations. The **skill** tells an agent how to create and execute Burnlists. The **hooks** capture editing activity for Streaming Diff. Installing one does not install, require, or remove the other.

## Skill Discovery

The skills CLI surface is:

```sh
burnlist install [--global] [--agent codex,claude] [--dry-run] [--commit]
burnlist uninstall [--global] [--agent codex,claude] [--dry-run] [--purge]
```

By default, `burnlist install` registers the bundled Burnlist skill for both agents in the current repository:

| Agent | Per-repository target | Global target (`--global`) |
| --- | --- | --- |
| Claude Code | `<repo>/.claude/skills/burnlist` | `~/.claude/skills/burnlist` |
| Codex | `<repo>/.agents/skills/burnlist` | `~/.agents/skills/burnlist` |

The default per-repository mode is a managed symlink and adds its target to `.git/info/exclude`, so it stays local and untracked. `--global` creates the managed global registrations instead. `--commit` is per-repository only: it creates a portable managed copy and removes Burnlist's local exclusion entry so the copy can be added to Git. `--agent codex`, `--agent claude`, or `--agent codex,claude` limits registrations; without it, both agents are targeted. `--dry-run` prints the planned link or copy operations without writing.

For a Git worktree, the command reports the default mode as `untracked (local, .git/info/exclude)`, `--commit` as `committable (portable copy; run git add to track)`, and global registrations as `global symlink (no repo exclude)`. A non-Git directory instead reports `symlink (no git repo to exclude into)` or `portable copy (no git repo)`.

`burnlist uninstall` removes only Burnlist-managed registrations in the matching scope and removes its matching local exclusion entries. `--purge` requires `uninstall --global`, targets both agents, and also uninstalls the global npm package.

## Streaming Diff Edit-Capture Hooks

The hooks CLI surface is:

```sh
burnlist hooks [install|uninstall|status] [--agent codex,claude] [--untracked]
```

Bare `burnlist hooks` defaults to `status`.

`burnlist hooks install` is repository-only and must run inside a Git worktree; there is no `--global` flag. It adds managed `burnlist streaming-diff hook` commands while preserving unrelated hook entries:

| Agent that consumes the hook | Config written at the worktree root | Events |
| --- | --- | --- |
| Codex | `<repo>/.codex/hooks.json` | `SessionStart`, `PreToolUse`, `PostToolUse` |
| Claude Code | `<repo>/.claude/settings.json` | `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |

The edit events are matched to each agent's write/edit tools, so the configured commands capture Streaming Diff activity around edits. Codex hook support requires Codex CLI 0.124.0 or newer; `status` reports whether the installed CLI can run the configured hooks. The hook commands require `burnlist` to be available on the host `PATH`; each agent may still ask for its own hook trust or consent.

By default, an untracked hook config is added to `.git/info/exclude`, making it local. A tracked config remains shared with the team. `--untracked` asks install to add the config to that local exclude file even when it is tracked, but Git cannot hide an already tracked file. Burnlist records only configs it created under `<repo>/.local/burnlist/` so uninstall can remove an otherwise-empty created config; it removes only its exact hook entries and leaves unrelated configuration intact.

Use `burnlist hooks status` to report each selected agent's hook state, whether its config is tracked or local, and CLI capability. `burnlist hooks uninstall` removes Burnlist's managed hook entries and its matching local-exclude entry. Both default to Codex and Claude; use `--agent codex`, `--agent claude`, or `--agent codex,claude` to limit the operation.

The status output uses hook states `installed`, `none`, `partial`, or `corrupt`; it labels configuration as `shared with the team; info/exclude cannot hide tracked config`, `local (listed in .git/info/exclude)`, or `local (not listed in .git/info/exclude)`. Capability output is `installed+hooks-supported`, `installed-but-hooks-unsupported` (including the required minimum), or `not-installed`.

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
