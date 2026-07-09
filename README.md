# <img src="skills/burnlist/dashboard/public/favicon.svg" width="30" height="30" alt="Burnlist logo" /> Burnlist

Burnlist is a real-time, non-invasive tracker for agents. It keeps repo-local task state as a small, shrinking queue and exposes it through a read-only local dashboard without taking over implementation, tests, or delivery. It includes two default Ovens and lets anyone create their own.

## What ships

- One agent skill for creating, hardening, executing, and maintaining Burnlists.
- A local observer dashboard with two default Ovens:
  - **Checklist** preserves the current Burnlist Progress queue-completion behavior.
  - **Target** applies source-backed, current-gate discipline to measured convergence work.
- **Custom Ovens** created from Markdown instructions and a non-executable detail skeleton.

An Oven is a declarative Burn recipe: Markdown instructions plus a non-executable detail skeleton. It can describe outcome, state, inputs, evidence, and normalized data presentation; it cannot execute code, mutate project state, or start an agent. See the [Oven contract](skills/burnlist/references/oven-contract.md).

```text
skills/
  burnlist/                 # the single installed skill
    SKILL.md
    ovens/
      checklist/
        instructions.md
        detail.json
      target/
        instructions.md
        detail.json
```

## Install

```sh
npm install --global burnlist
```

That is the entire public installation flow. It installs the `burnlist` command and automatically registers the bundled `burnlist` skill under `$HOME/.agents/skills`.

Start the local dashboard from any project:

```sh
burnlist
```

Uninstall through the Burnlist CLI so it removes only its own skill symlinks before asking npm to remove the package:

```sh
burnlist uninstall
```

## Verify

```sh
npm run build:dashboard
npm run verify
npm run verify:clean
npm run verify:package
npm run test:global-install
```

`verify:clean` repeats source, npm payload, and isolated global install/uninstall checks from a temporary copy without local state or generated artifacts.

## Boundaries

Keep `.local/`, real `notes/burnlists/` history, dashboard build output, screenshots, and npm tarballs out of version control. Custom Ovens and Run snapshots live under ignored `.local/burnlist/` state.

## License

GPL-3.0-or-later.
