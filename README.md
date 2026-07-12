# <img src="skills/burnlist/dashboard/public/favicon.svg" width="30" height="30" alt="Burnlist logo" /> Burnlist

Burnlist is a real-time, non-invasive tracker for agents. It tracks a repo-local, shrinking work queue in a read-only local dashboard and stays out of implementation, testing, and delivery.

## What ships

- One agent skill for creating, hardening, executing, and maintaining Burnlists.
- A local observer dashboard with two default Ovens:
  - **Checklist** tracks completion of the active work queue.
  - **Differential Testing** evaluates aligned reference and candidate series, optional aggregate telemetry, and optional exact-first authority through one project-neutral contract.
- Custom Ovens built from Markdown instructions and a non-executable detail skeleton.

An Oven is a declarative recipe for an agent run. It defines the goal, canonical state, inputs, evidence, and normalized data presentation. It cannot execute code, produce project data, or change project state. See the [Oven contract](skills/burnlist/references/oven-contract.md).

Anyone can create a custom Oven. Burnlist stores it under local state and snapshots it when a run starts.

## Differential Testing data

Projects can feed the shared Differential Testing renderer without importing project code. Publish a `burnlist-differential-testing-data@1` current payload plus catalog-listed sibling scenario payloads, validate the current payload, then bind it read-only:

```sh
burnlist differential-testing validate /absolute/path/to/bundle/current.json
burnlist --oven-data differential-testing=/absolute/path/to/bundle/current.json
```

Run `burnlist differential-testing schema` to locate the packaged JSON Schema. The [Differential Testing data contract](skills/burnlist/references/differential-testing-data.md) defines sample states, reconciliation, scenario selection, event-driven refresh state, history identity, the adapter boundary, aggregate telemetry, and adapter-attested exact sessions with fail-closed Target selection. Exact-prefix verification is the only retention authority; refresh state remains telemetry.

A project with no canonical scenarios publishes the explicit empty bundle state; Burnlist shows `No Differential Testing scenarios` and does not discover legacy files.

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
npm run test:differential-testing
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
