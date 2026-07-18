# AGENTS.md — Burnlist

Guidelines for any agent (or human) writing code here. Scoped `AGENTS.md` files live
in subfolders with their own rules; the **nearest one wins**. Keep every `AGENTS.md`
tiny (≤ 200 lines). `CLAUDE.md` in each folder is a symlink to its `AGENTS.md`.

## Non-negotiables
- **Zero runtime dependencies.** CLI + server are pure Node built-ins
  (`node:http/fs/path/crypto/os`), ES modules, Node ≥ 18. `dependencies` stays empty
  (React/Vite/etc. are `devDependencies` only).
- **New files ≤ 400 lines.** Split before you cross it. Existing large files (e.g. the
  dashboard server, the DT renderer) are *grandfathered decomposition targets* — not a
  licence to add more.
- **`npm run verify` must pass** before anything is "done." It syntax-checks every
  `.mjs`, runs the contract tests, and scans for leaks.
- **Atomic writes** — temp file/dir then `rename`; never leave a partial file a reader
  can observe. Take a lock where the server + CLI can race on the same `.local/`.

## Boundaries
- **The dashboard is a read-only observer** — it never mutates canonical burnlist
  state, lifecycle folders, or the registry. Writes are CLI-only (or token-gated,
  loopback-only `.local/` controller POSTs).
- **Ovens are declarative and non-executable** — data, never code. No `eval`, no
  runtime component/renderer injection, no imported UI.

## Agent integrations
- Skills (`burnlist install`) and Streaming Diff hooks (`burnlist hooks install`) are
  independent. Keep their docs accurate and separate; see `README.md` and
  `skills/burnlist/references/installation.md` before changing either surface.

## Hygiene
- **Conventional commits** (`feat:`/`fix:`/…); reference a burnlist item id when one
  applies: `feat: … (auth-07)`.
- **No personal paths, secrets, or internal codenames** in committed files (verify's
  leak scan enforces this).
- Match the surrounding code; prefer small, pure, testable modules. Add/adjust
  `*.test.mjs` (`node:test`) with every behavior change.

Scoped `AGENTS.md` files get added to specific folders **as the code stabilizes**
(e.g. during the pure-module extraction and the widget-library split) — a nearer
file overrides this root. None exist yet; this root is the whole ruleset for now.
