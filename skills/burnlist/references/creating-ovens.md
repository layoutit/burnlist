# Creating `.oven` Sources

Practical guide to the current declarative `.oven` source path. Read
`references/oven-authoring.md` and `references/oven-contract.md` for the older
`detail.json` skeleton and its package contract; `.oven` is the current
source-of-truth path for the built-in dashboard views.

## What an Oven Is

An Oven is declarative, non-executable data. It ships no JavaScript, CSS,
`eval`, or component imports. A project adapter supplies one read-only payload;
the Oven only declares how the shared runtime presents that payload.

```text
human .oven source
  -> compileOven: scanXml -> validateOven -> buildIR
  -> frozen burnlist-oven-ir@1 JSON (<id>.ir.json, committed)
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

## Root and Registry

Every source has exactly one root:

```xml
<oven id="streaming-diff"
      version="1"
      contract="burnlist-streaming-diff-data@2"
      refresh-seconds="2"
      theme="streaming-diff">
  <!-- allowed children -->
</oven>
```

`id`, `version`, `contract`, and `theme` are required. `refresh-seconds` is
optional. Version is currently `1`; `refresh-seconds` is a positive integer no
greater than 3600.

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
item. The richer fixture at `src/ovens/dsl/__fixtures__/checklist.oven` shows
both forms:

```xml
<each>
  <kpi-item>
    <bind prop="heading" source="@item/title" format="plain"/>
    <bind prop="value" source="@item/id" format="plain"/>
  </kpi-item>
</each>

<log-table source="/timeline">
  <column label="Time" source="@item/time" format="time-only"/>
</log-table>
```

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

1. Create this package layout and begin with the simple pattern in
   `ovens/streaming-diff/streaming-diff.oven`:

   ```text
   ovens/<id>/
     <id>.oven
     <id>.ir.json
     instructions.md
     engine/
       contract + handler + adapter
   ```

   ```xml
   <oven id="streaming-diff" version="1"
         contract="burnlist-streaming-diff-data@2" theme="streaming-diff">
     <streaming-diff-heading session="/identity/session" back-href="/backHref"/>
     <diff-card source="/cards"/>
   </oven>
   ```

2. Provide the data contract and adapter in `ovens/<id>/engine/`. Record the
   payload shape and pointer meanings in `ovens/<id>/instructions.md`. The
   source stays declarative; the adapter owns producing the read-only document.

3. Reuse a registered theme when its chrome fits. The four registered entries
   live in `dashboard/src/oven/runtime/theme-registry.ts`: `checklist`,
   `streaming-diff`, `visual-parity`, and `differential-testing`. Add a theme
   entry only when the chrome must differ.

4. Compile `<id>.oven` with `compileOvenFile`, fail on diagnostics, write the
   resulting `ir` atomically as `<id>.ir.json`, and commit the artifact beside
   the source:

   ```js
   import { compileOvenFile } from "./src/ovens/dsl/oven-compile.mjs";

   const result = await compileOvenFile("ovens/<id>/<id>.oven");
   if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
   // Atomically write JSON.stringify(result.ir) to ovens/<id>/<id>.ir.json.
   ```

5. Add a byte-golden gate. Follow
   `dashboard/src/oven/runtime/streaming-diff-oven-dom-golden.test.mjs` and
   `dashboard/src/oven/runtime/checklist-oven-golden.test.mjs`: compile the
   `.oven`, deep-equal its IR to committed `<id>.ir.json`, render
   `OvenRuntime` with an adapted fixture, normalize the DOM, and compare it to
   the committed `*.golden.html`.

For a collection with id-wired controls, use
`ovens/differential-testing/differential-testing.oven` as the compact pattern:

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

For grid placement, collection iteration, `@item`, and the optional `box` /
`class` escape hatches, see `src/ovens/dsl/__fixtures__/checklist.oven`.
