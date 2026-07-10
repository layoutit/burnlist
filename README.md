# <img src="skills/burnlist/dashboard/public/favicon.svg" width="30" height="30" alt="Burnlist logo" /> Burnlist

Burnlist is a real-time, non-invasive tracker for agents. It tracks a repo-local, shrinking work queue in a read-only local dashboard and stays out of implementation, testing, and delivery.

## What ships

- One agent skill for creating, hardening, executing, and maintaining Burnlists.
- A local observer dashboard with two default Ovens:
  - **Checklist** tracks completion of the active work queue.
  - **Compare** evaluates aligned reference and candidate series through one trusted presentation contract.
- Custom Ovens built from Markdown instructions and a non-executable detail skeleton.

An Oven is a declarative recipe for an agent run. It defines the goal, canonical state, inputs, evidence, and normalized data presentation. It cannot execute code, produce project data, or change project state. See the [Oven contract](skills/burnlist/references/oven-contract.md).

Anyone can create a custom Oven. Burnlist stores it under local state and snapshots it when a run starts.

## Compare data

Projects can feed the shared Compare renderer without importing project code. Produce one `burnlist-compare-data@1` JSON file, validate it, then bind it read-only:

```sh
burnlist compare validate /absolute/path/to/compare.json
burnlist --oven-data compare=/absolute/path/to/compare.json
```

Run `burnlist compare schema` to locate the packaged JSON Schema. The [Compare data contract](skills/burnlist/references/compare-data.md) defines sample states, reconciliation rules, trust behavior, and the neutral example adapter.

## Install

```sh
npm install --global burnlist
```

This installs the `burnlist` command and registers the bundled skill under `$HOME/.agents/skills`.

Start the local dashboard from any project:

```sh
burnlist
```

To uninstall, run:

```sh
burnlist uninstall
```

## Verify

```sh
npm run build:dashboard
npm run test:compare
npm run verify
npm run verify:clean
npm run verify:package
npm run test:global-install
```

`verify:clean` runs the source, npm payload, and isolated global install checks from a temporary copy.

## Boundaries

Keep `.local/`, real `notes/burnlists/` history, dashboard build output, screenshots, and npm tarballs out of version control. Custom Ovens and Run snapshots live under ignored `.local/burnlist/` state.

## License

GPL-3.0-or-later.
