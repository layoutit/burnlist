# Designing Your Oven: Measure What You Can't Fake

## Why an Oven exists

An Oven makes progress objective so an agent cannot fool itself. It is the antidote to “I think it’s done”: a read-only view over evidence you compute, never a self-report.

## The design question

For your problem, ask: “What signal proves this is working, that I cannot fake or hand-wave?” Design the Oven around that signal.

## Measure proxy-resistant evidence

| Bad: self-reported and gameable | Good: objective and verifiable |
| --- | --- |
| “~80% done” | “142/200 tests pass” |
| “Looks good” | “3 byte-diffs remain” or “0 pixel drift” |
| “Should work” | “1,240/1,500 rows migrated and validated” |

The built-ins follow this rule. Differential Testing measures byte-identical goldens. Visual Parity measures pixel diffs. Streaming Diff captures the real pre-to-post diffs. Performance Tracing measures real timings against a budget. None accepts self-assessment. Your Oven should apply the same standard to your domain.

## What could you measure? (cheat-sheet)

| Problem type | Honest signal |
| --- | --- |
| Refactor | Test pass count, byte-diff against a frozen golden, and 0 type errors |
| Migration | Rows migrated and validated, schema conformance, and the legacy read still green |
| Feature | Acceptance checks passing |
| Bug fix | The failing reproduction now passes, with 0 regressions |
| Performance | Real measured timings against a baseline—never “feels faster” |

## From signal to Oven

Map each signal onto the built-in view vocabulary:

- Headline numbers → `kpi-strip`
- The event stream—what happened and when → `log-table`
- Burn-down → `progress-donut`

The real values come from a data adapter: a small, project-owned step that computes the honest numbers and writes them as one read-only JSON document. The Oven binds to those values by JSON pointer. Keep the Oven declarative: it says how to present the numbers and never computes them.

## The adapter: compute honest numbers, don't type them

The Oven is only the view. Between reality and the view sits the **adapter**: a small, project-owned script that reads a source of truth, computes the numbers, and writes the single read-only JSON document the Oven binds to. Skip it—hand-edit the JSON—and you have defeated the whole point: a number you typed proves nothing.

This complete adapter for a generic `checklist-progress@1` Oven counts validated rows from a real directory and writes the bound document. Node built-ins only:

```js
#!/usr/bin/env node
// migration-adapter.mjs — computes honest numbers from reality and writes the
// oven's bound JSON. Node built-ins only. The project runs this, not Burnlist.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const rows = new URL('./migrated-rows/', import.meta.url);
const files = (await readdir(rows)).filter((n) => n.endsWith('.json'));

let validated = 0, schemaFailures = 0;
for (const name of files) {
  try {
    const row = JSON.parse(await readFile(new URL(name, rows), 'utf8'));
    if (row && typeof row.id === 'string') validated += 1; else schemaFailures += 1;
  } catch { schemaFailures += 1; }
}

const out = new URL('./.local/burnlist/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('migration-status-data.json', out), JSON.stringify({
  validatedFraction: files.length ? validated / files.length : 0,
  schemaFailures,
  legacyReadGreen: null,   // unwired: no adapter reads the legacy path yet — never fabricate it
  events: files.map((n) => `validated ${n}`),
}, null, 2) + '\n');
```

The Oven that binds to that document reads each pointer by name:

```xml
<oven id="migration-status" version="1" contract="checklist-progress@1" theme="checklist">
  <section-header title="Migration status"/>
  <kpi-strip>
    <kpi-item heading="Rows validated" source="/validatedFraction" format="percent"/>
    <kpi-item heading="Schema failures" source="/schemaFailures" format="number"/>
    <kpi-item heading="Legacy read" source="/legacyReadGreen" fallback="not wired"/>
  </kpi-strip>
  <log-table source="/events"><column label="Event" source="@item"/></log-table>
</oven>
```

Run the adapter, then wire and view the Oven:

```sh
node migration-adapter.mjs                                              # writes .local/burnlist/migration-status-data.json
burnlist oven create migration-status --instructions instr.md --oven migration-status.oven
burnlist oven bind migration-status .local/burnlist/migration-status-data.json
burnlist --scan-root .                                                  # dashboard renders the bound numbers
```

### An unwired number is worse than no number

Notice `legacyReadGreen: null`. The adapter does **not** yet read the legacy path, so it reports `null`—never a plausible-looking `true`. State the principle plainly:

> An Oven is only as honest as its adapter. An unwired number is worse than no number: a real gap that reads as a fabricated pass makes the agent trust a lie.

When a signal is not yet wired to reality, report `null` (or `"wired": false`)—never a fabricated number—and make wiring that signal the **next Burnlist item**. The Oven's `fallback="not wired"` renders the gap honestly instead of hiding it.

### Who runs the adapter, and when

The **project owns and runs the adapter—Burnlist never does.** Nothing in Burnlist executes it: `burnlist oven bind` only records where the JSON lives, and the dashboard only reads it. Re-run the adapter after each batch of work, on a schedule, or in CI, so the Oven reflects current reality. A stale adapter is a stale Oven.

## Point a Burnlist item at an Oven number

An Oven signal is only evidence if a Burnlist item's done/delete condition cites it instead of a self-report:

```markdown
- [ ] B4 | Cut over reads to the migrated schema
  Files/search: `src/db/`, `migrated-rows/`
  Action: point the read path at the migrated schema and validate every row.
  Done/delete when: Oven `migration-status` shows `validatedFraction = 100%` and `schemaFailures = 0`.
  Validate: re-run the adapter, then read the Oven in the dashboard.
```

This link is **advisory evidence a human or agent reads—Burnlist does not execute the Oven or auto-verify the number.** `burnlist burn` and `burnlist --check` validate the Burnlist protocol and record the burn; they never open the Oven or read its bound JSON. The honesty is structural: the item's proof points at an objective, adapter-computed signal, so closing the item means opening the Oven (or its JSON) and confirming the number—not asserting "done." See [Proof Authority in Burnlist Creation](burnlist-creation.md) and [Oven Authoring](oven-authoring.md).

For the `.oven` grammar and a full worked example, see [Creating Ovens](creating-ovens.md). For creating and binding an Oven from the CLI—`burnlist oven create`, `burnlist oven bind`, and `burnlist oven view`—see [Oven Authoring](oven-authoring.md).

If a number can be typed by hand without doing the work, it is not evidence—measure the thing the work would have to produce.
