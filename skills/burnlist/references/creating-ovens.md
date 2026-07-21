# Creating `.oven` Sources

Practical guide to the declarative `.oven` source path. `.oven` is the sole
canonical Oven structure; `detail.json` is retired and survives only in a
read-only legacy path for old run snapshots. Read
`references/oven-authoring.md` and `references/oven-contract.md` for the
current package contract and CLI guidance.

## What an Oven Is

An Oven is declarative, non-executable data. It ships no JavaScript, CSS,
`eval`, or component imports. A project adapter supplies one read-only payload;
the Oven only declares how the shared runtime presents that payload.

```text
human .oven source
  -> compileOven: scanXml -> validateOven -> buildIR
  -> frozen burnlist-oven-ir@1 JSON (build-generated)
  -> browser imports IR; OvenRuntime renders it through the shared engine + theme
```

`compileOven(source)` returns diagnostics or a frozen IR. Use
`compileOvenFile(path)` when compiling a file. The IR preserves the source
tree, derives `controls`, `collections`, and `requirements`, camel-cases
attributes such as `back-href` to `backHref` and `column-span` to
`columnSpan`, and converts these attributes to numbers:

```text
version, refresh-seconds, columns, rows, row-height, column, row,
column-span, row-span, page-size, debounce-ms
```

`optional` and `default` become booleans. `plain` is stored in IR as the
`identity` format alias.

## Closed contract and theme allowlist

**A custom Oven cannot define a new contract, theme, or icon.** It must reuse a
built-in pair. For a generic KPI-and-table Oven over arbitrary project JSON,
use `contract="checklist-progress@1"` and `theme="checklist"`. The remaining
contracts, themes, and the specialized widgets belong to their matching
normalized-data contracts.

Unknown values are rejected when creating the Oven:

```text
burnlist oven: Oven <id> .oven source is invalid: Unknown theme <x>
burnlist oven: Oven <id> .oven source is invalid: Unknown contract <x>
```

Every source has exactly one root:

```xml
<oven id="streaming-diff"
      version="0.1.0"
      contract="burnlist-streaming-diff-data@2"
      refresh-seconds="2"
      theme="streaming-diff">
  <!-- allowed children -->
</oven>
```

`id`, `version`, `contract`, and `theme` are required. `refresh-seconds` is
optional. Version is a semver identity; built-in Ovens currently use `0.1.0`.
`refresh-seconds` is a positive integer no greater than 3600. The complete
closed registries are:

| Registry | Exact allowed values |
| --- | --- |
| contracts | `checklist-progress@1`, `burnlist-differential-testing-data@1`, `burnlist-streaming-diff-data@2`, `burnlist-visual-parity-data@1` |
| themes | `checklist`, `differential-testing`, `streaming-diff`, `visual-parity` |
| icons | `ClipboardList`, `Clock3`, `Gauge`, `TimerReset` |

## Vocabulary

The compiler rejects unknown elements, attributes, and parent/child
combinations. The following is the complete author-facing vocabulary, grouped
by purpose; attributes shown are the grammar's allowed attributes.

### Layout

| Element | Allowed attributes | Direct children |
| --- | --- | --- |
| `box` | `id`, `element`, `class`, `text`, `data-detail-tab` | layout, display, interaction, and `refresh-status` where permitted by the grammar |
| `grid` | `id`, `columns`, `rows`, `row-height` | `box`, `panel`, `stack`, KPI, checklist, table, collection, toolbar, and switch elements |
| `stack` | `id`, `direction`, `gap` | `box`, `grid`, `panel`, `stack`, KPI, checklist, table, collection, toolbar, switch, `refresh-status` |
| `panel` | `id`, `title`, `column`, `row`, `column-span`, `row-span` | layout, KPI, checklist, table, collection, toolbar, switch, `mode-toggle` |

`box` requires `element`, whose value is one of `div`, `section`, `main`, or
`span`. `grid` requires `columns`; grid panels cannot overlap or exceed its
declared bounds. `panel` requires `id`.

### Display widgets

| Widgets | Allowed attributes and children |
| --- | --- |
| `kpi-strip` / `kpi-item` | The strip accepts `id`, `aria-label`, `class`, `title` and contains `kpi-item`. An item accepts `id`, `class`, `heading`, `title`, `value`, `icon`, `variant`, `source`, `format`, `optional`, `fallback`, `slot`; it may contain `bind`, `text`, `icon`, `progress-donut`, `burn-donut`, `waffle-metric`, `progress-value`. |
| `section-header` / `log-table` / `column` | Header: `id`, `class`, `title`, `source`, `format`, `optional`, `fallback`, `slot`, with `bind`, `text`, `icon`. Table: `id`, `class`, `title`, `source`, `empty-text`, with `column`. Column: `label`, `source`, `format`, `optional`, `fallback`, `tone`. |
| `verdict-header`, `metric-tiles`, `domain-tabs`, `domain-note`, `frame-card` | `verdict-header` takes `id` and `bind`; `metric-tiles` takes `id`, `source`, `selection-from`, and `bind`; `domain-tabs` takes `id`, `source`, `initial-source`, `format`; `domain-note` takes `id`, `source`, `selection-from`, and `bind`; `frame-card` takes `id`, `source`, `format`, `optional`, `fallback`, `slot`, `selection-from`, and may contain `bind`, `text`, `icon`. |
| `image-triptych`, `feed-list`, `diff-card`, `file-diff` | `image-triptych` and `feed-list` take `id` and `bind`. `diff-card` and `file-diff` take `id`, `source`, `format`, `optional`, `fallback`, `slot`, and may contain `bind`, `text`, `icon`. |
| `refresh-status` / `streaming-diff-heading` | `refresh-status` takes `id`, `source`, `format`, `optional`, `fallback`, `slot`. `streaming-diff-heading` takes `id`, `session`, `back-href`. |
| Checklist widgets | `checklist-burn-panel`, `checklist-ledger`, and `checklist-event-cards` each take `id`, `source`, `format`, `optional`, `fallback`, `slot`. |
| Differential widgets | `differential-kpi-strip`, `differential-log-table`, `progress-chart`, and `frame-delta-chart` each take `id`, `source`, `format`, `optional`, `fallback`, `slot`. `differential-empty-state` takes `id`, `title`. |

Only registered icons may be used by `<icon name="...">` or `kpi-item`
`icon`. Registered `kpi-item` variants are `current`, `scenario`, `burns`,
`fields`, and `frames`.

### Interactivity and collections

| Element | Allowed attributes and structure |
| --- | --- |
| `switch` / `case` | A switch takes `id`, `source`, `mode-from` and contains `case`; it requires exactly one of `source` or `mode-from`. A case takes `value`, `default`, and requires either `value` or `default="true"`. |
| `collection` | Requires `id`, `source`, `item-key`, `paging`, `page-size`; it may also use `search-from`, `filter-from`, `sort-from`, and contains `each`, `field-list`, and/or `pagination`. `paging` is `client`, `server`, or `auto`. |
| `each` / `field-list` / `pagination` | `each` has no attributes and contains a grid, stack, panel, KPI item, section header, table, or switch. `field-list` takes `id`, `collection-from`, `mode-from` and contains `bind`. `pagination` requires `collection-from`, `page-sizes`, and must be inside a collection. |
| `field-toolbar` | Requires `id` and contains `search`, `mode-toggle`, `sort-toggle`, and/or `filter-toggle`. |
| Toolbar controls | `search`: `id`, `placeholder`, `aria-label`, `match-fields`, `debounce-ms`; `mode-toggle`: `id`, `initial`, `aria-label`, with at least two `option` children; `option`: `value`, `label`; `sort-toggle`: `id`, `key`, `label`, `initial`, `requires-source`, `requires-value`, `unavailable-text`; `filter-toggle`: `id`, `key`, `label`, `initial`. |

The registered sort key is `changed`; the registered filter key is `non-pass`.
Controls are not allowed inside `each`.

## Binding and Control Wiring

`source="/json/pointer"` reads the adapter document using an RFC 6901 pointer.
For a component with named input properties, use a child binding:

```xml
<bind prop="heading" source="/summary/title" format="plain"/>
```

`bind` requires `prop` and `source`; it may also have `format`, `optional`, and
`fallback`. `text` similarly accepts `slot`, `text`, `source`, `format`,
`optional`, and `fallback`, but requires exactly one of `text` or `source`.
`icon` requires both `slot` and `name`.
Every `format` must be one of:

```text
identity, plain, number, percent, delta, ratio-to-percent, length, time-only,
relative-age, progress-headline, last-progress-percent, last-failed-count,
last-failed-percent, last-frame-delta, last-delta-percent, index-by-id,
telemetry-availability
```

Inside an `each` or a `column` scope, `@item/...` reads the current collection
item. This self-contained collection and table example shows both forms:

```xml
<collection id="active-items" source="/active" item-key="/id" paging="client" page-size="25">
<each>
  <kpi-item>
    <bind prop="heading" source="@item/title" format="plain"/>
    <bind prop="value" source="@item/id" format="plain"/>
  </kpi-item>
</each>
</collection>

<log-table source="/timeline" empty-text="No timeline events yet.">
  <column label="Time" source="@item/time" format="time-only"/>
  <column label="Event" source="@item/title" format="plain"/>
</log-table>
```

`tone` on a `<column>` is appended verbatim as an extra CSS class on the
rendered cell, alongside `log-table-cell` and the column-label slug. It has no
fixed enum and is visible only when the active theme stylesheet defines that
class. In a generic checklist-theme Oven, leave `tone` unset unless the chosen
theme styles the token.

### Format semantics

Formats transform a `source` or `bind` value before display. The generic formats
are appropriate for generic custom Ovens:

| Format | Input shape → output |
| --- | --- |
| `identity` / `plain` | Any value → unchanged. `plain` is the identity alias stored in IR as `identity`; use it for verbatim strings and ids. |
| `number` | Numeric value or numeric string → integer-grouped string with no decimals; `1234.7` → `"1,235"`. Empty or non-finite → `""`. |
| `percent` | Fraction from 0 through 1 → percentage string with two decimals, or three below `0.01`; `0.96` → `"96.00%"`, `0.005` → `"0.500%"`. Null or undefined → `""`. |
| `delta` | Number → up to four decimals with trailing zeroes trimmed; `0.5` → `"0.5"`, `1.25` → `"1.25"`. Null or undefined → `""`. |
| `ratio-to-percent` | Fraction number from 0 through 1 → numeric value ×100, not a string; `0.96` → `96`. Null or non-finite → undefined. |
| `length` | String or array → numeric `.length`; any other type → undefined. |
| `time-only` | ISO timestamp, date string, or epoch → local 24-hour `"HH:MM"`; `"2026-07-20T09:05:00Z"` → `"09:05"`. Unparseable → `""`. |
| `relative-age` | Timestamp → compact age from now: under 60 seconds `"Ns"`, under 60 minutes `"Nm"`, under 24 hours `"Nh"`, otherwise `"Nd"`; about three hours ago → `"3h"`. Unparseable → `""`. |

The following eight formats are **Differential-Testing-only**. They read the
last row of a Differential-Testing result-row array unless noted otherwise.
Generic Oven authors should not use them.

| Format | Input shape → output |
| --- | --- |
| `progress-headline` | Last row → `"frame/frames"` string. |
| `last-progress-percent` | Last row's `frame/frames` ratio → number ×100. |
| `last-failed-count` | Last row's failed-field count → string. |
| `last-failed-percent` | Last row's `failed/total` field ratio → number ×100. |
| `last-frame-delta` | Last row's absolute frame delta → string, or `"—"` when absent. |
| `last-delta-percent` | Last row's absolute frame delta divided by frames → number ×100. |
| `index-by-id` | Array of `{id, …}` objects → object keyed by each `id`. |
| `telemetry-availability` | Telemetry payload → its availability descriptor. |

Declare controls with an `id`, then name that id from consumers:
`search-from` targets `search`, `sort-from` targets `sort-toggle`,
`filter-from` targets `filter-toggle`, `mode-from` targets `mode-toggle`,
`selection-from` targets `domain-tabs`, and `collection-from` targets
`collection`. `domain-tabs initial-source` is instead a JSON pointer for the
initial selection. A `switch` can read a pointer through `source` or a
`mode-toggle` id through `mode-from`.

These components require exactly one `bind` for every named property:

| Component | Required bound properties |
| --- | --- |
| `metric-tiles` | `passed`, `total`, `ratio`, `meanAbsoluteDelta`, `maximumAbsoluteDelta` |
| `verdict-header` | `targetPass`, `framesCount`, `error` |
| `image-triptych` | `images`, `label`, `frame` |
| `feed-list` | `feeds`, `error`, `loading`, `showRepository` |
| `domain-note` | `isTarget`, `rationale` |

## Keep Sources Clean

Normal Ovens use neither `class=` nor `<box>`. The five shipped sources
(`streaming-diff`, `checklist`, `visual-parity`, `performance-tracing`, and
`differential-testing`) follow that rule: theme entries and shared components
supply chrome and default classes.

`class=` is an optional escape hatch only on `box`, `kpi-strip`, `kpi-item`,
`section-header`, and `log-table`. `<box element="..." class="...">` is the
corresponding super-custom escape hatch. Keep both out of ordinary sources.

## Author a New Oven

First run `burnlist init` from the repository; then author an `instructions.md`
with a level-one heading and a `.oven` file. Create the package with
`burnlist oven create <id> --instructions <file> --oven <file>`, then bind the
JSON payload with `burnlist oven bind <id> <path>`. The CLI and dashboard details
are in `references/oven-authoring.md`.

The `<oven version="0.1.0">` value is the Oven's `id@version` identity, not its
content revision. To pin a shipped Oven per project, run `burnlist oven adopt
<id>`; it is committed under `.burnlist/ovens/<id>/`, so a Burnlist CLI upgrade
never changes it.

Here is a complete generic KPI-and-table source, `kpi.oven`:

```xml
<oven id="deploy-status" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <section-header title="Deploy status"/>
  <kpi-strip>
    <kpi-item heading="Service" source="/service"/>
    <kpi-item heading="Healthy" source="/healthyPct" format="percent"/>
    <kpi-item heading="Last deploy" source="/deployedAt" format="relative-age"/>
  </kpi-strip>
  <log-table source="/events"><column label="Event" source="@item"/></log-table>
</oven>
```

Bind it to `deploy-data.json`:

```json
{
  "service": "checkout-api",
  "healthyPct": 0.96,
  "deployedAt": "2026-07-20T09:00:00Z",
  "events": ["09:00 deploy started", "09:02 healthy", "09:05 traffic shifted"]
}
```

`healthyPct` renders as `"96.00%"`; `deployedAt` renders a compact age such as
`"3h"`. The source remains declarative; an adapter, if needed, only produces
the read-only JSON document. Record pointer meanings and payload shape in the
Oven instructions so the agreement is discoverable.

For a collection with id-wired controls, use this compact pattern:

```xml
<field-toolbar id="field-controls">
  <search id="field-search" placeholder="Search Fields..."
          aria-label="Differential Testing search fields"
          match-fields="/label /sourceOwner /driftClass /semantics/kind"/>
  <filter-toggle id="failed-filter" key="non-pass" label="Failed" initial="off"/>
</field-toolbar>
<collection id="field-view" source="/fields" item-key="/id"
            search-from="field-search" filter-from="failed-filter"
            paging="auto" page-size="25">
  <field-list collection-from="field-view"/>
  <pagination collection-from="field-view" page-sizes="25 50 100 200"/>
</collection>
```

Use the earlier collection example for iteration and `@item`. `box` and `class`
remain optional escape hatches; ordinary sources should not need either.
