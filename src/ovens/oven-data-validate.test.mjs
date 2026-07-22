import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getOvenHandler } from "./oven-registry.mjs";
import {
  SHAPE_ONLY_WARNING,
  validateOvenData,
} from "./oven-data-validate.mjs";

const customSource = (body) => `<oven id="custom-shape" version="0.1.0" contract="checklist-progress@1" theme="checklist">${body}</oven>`;

test("built-in validation dispatches through the registered runtime authority", () => {
  const payload = { schema: "plausible-but-not-runtime-valid" };
  let runtimeError;
  try {
    getOvenHandler("differential-testing").validateData(payload);
  } catch (error) {
    runtimeError = error;
  }

  const result = validateOvenData({ id: "differential-testing" }, payload);

  assert.equal(result.ok, false);
  assert.equal(result.authority, "runtime");
  assert.deepEqual(result.errors, runtimeError.issues);
  assert.deepEqual(result.warnings, []);
});

test("built-in success and producer-managed rejection are capability-driven", () => {
  const payload = { any: ["JSON", "shape"] };
  assert.deepEqual(validateOvenData({ id: "checklist" }, payload), {
    ok: true,
    authority: "runtime",
    payload,
    errors: [],
    warnings: [],
  });

  const producer = validateOvenData({ id: "streaming-diff" }, payload);
  assert.equal(producer.ok, false);
  assert.equal(producer.authority, "producer-managed");
  assert.match(producer.errors[0].message, /producer-managed.*single JSON payload/u);
});

test("custom Ovens receive shape-only pointer validation", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <stack>
        <kpi-item heading="Summary"><progress-donut source="/summary/~0value"/></kpi-item>
        <section-header title="Details"><bind prop="count" source="/rows/0/~1count"/></section-header>
      </stack>`),
  };
  const payload = { summary: { "~value": 2 }, rows: [{ "/count": 1 }] };

  assert.deepEqual(validateOvenData(oven, payload), {
    ok: true,
    authority: "shape-only",
    payload,
    errors: [],
    warnings: [SHAPE_ONLY_WARNING],
  });

  const missing = validateOvenData(oven, { summary: { "~value": 2 }, rows: [{}] });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors, [{
    path: "/rows/0/~1count",
    message: "Oven source pointer does not resolve in the payload.",
  }]);
});

test("closed specialized widgets still validate their source pointers", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource('<model-lab-view source="/model"/>'),
  };

  assert.equal(validateOvenData(oven, { model: {} }).ok, true);
  assert.deepEqual(validateOvenData(oven, {}).errors, [{
    path: "/model",
    message: "Oven source pointer does not resolve in the payload.",
  }]);
});

test("custom item pointers resolve against each collection item", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <collection id="rows" source="/rows" item-key="/id" paging="client" page-size="10">
        <each><kpi-item heading="Value" source="@item/value"/></each>
      </collection>`),
  };

  assert.equal(validateOvenData(oven, { rows: [{ id: "a", value: 1 }] }).ok, true);
  assert.deepEqual(validateOvenData(oven, { rows: [{ id: "a" }] }).errors, [{
    path: "@item/value",
    message: "Oven source pointer does not resolve for collection item 0.",
  }]);
  assert.equal(validateOvenData(oven, { rows: [] }).ok, true);
});

test("custom validation checks literal-or-pointer runtime attributes", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <kpi-strip aria-label="/labels/strip" title="/titles/strip">
        <kpi-item heading="/labels/item" title="/titles/item" value="/values/item">
          <progress-value done="/progress/done" total="/progress/total" percent="/progress/percent"/>
        </kpi-item>
      </kpi-strip>
      <differential-empty-state title="/titles/empty"/>
      <streaming-diff-heading session="/session/name" back-href="/session/back"/>`),
  };
  const payload = {
    labels: { strip: "Summary", item: "Item" },
    titles: { strip: "Strip", item: "KPI", empty: "Empty" },
    values: { item: 1 },
    progress: { done: 1, total: 2, percent: 50 },
    session: { name: "run", back: "/" },
  };

  assert.equal(validateOvenData(oven, payload).ok, true);
  assert.deepEqual(validateOvenData(oven, {}).errors.map((error) => error.path), [
    "/labels/strip", "/titles/strip", "/labels/item", "/titles/item", "/values/item",
    "/progress/done", "/progress/total", "/progress/percent", "/titles/empty",
    "/session/name", "/session/back",
  ]);
});

test("interactive nodes nested under each do not inherit its item scope", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <field-toolbar id="tools">
        <search id="query" placeholder="Find" aria-label="Find" match-fields="/name"/>
      </field-toolbar>
      <collection id="groups" source="/groups" item-key="/id" paging="client" page-size="10">
        <each><grid columns="1">
          <collection id="rows" source="@item/rows" item-key="/key" search-from="query" paging="client" page-size="10">
            <each><stack>
              <log-table source="@item/events">
                <column label="Message" source="@item/message"/>
                <column label="Note" source="@item/note" optional="true"/>
              </log-table>
            </stack></each>
          </collection>
        </grid></each>
      </collection>`),
  };
  const payload = { groups: [{ id: "g", rows: [{ key: "r", name: "row", events: [{ message: "ok" }] }] }] };

  assert.deepEqual(validateOvenData(oven, payload).errors.map((error) => error.path), [
    "@item/rows", "@item/events",
  ]);

  const nested = {
    id: "custom-shape",
    oven: customSource(`
      <collection id="rows" source="/rows" item-key="/id" paging="client" page-size="10">
        <each><stack>
          <switch source="@item/mode"><case value="on"><section-header title="On"/></case></switch>
          <log-table source="@item/events"><column label="Message" source="@item/message"/></log-table>
        </stack></each>
      </collection>`),
  };
  assert.deepEqual(validateOvenData(nested, {
    rows: [{ id: "a", mode: "on", events: [{ message: "visible" }] }],
  }).errors.map((error) => error.path), ["@item/mode", "@item/events"]);
});

test("iterated runtime sources must resolve to arrays", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <domain-tabs id="tabs" source="/tabs" initial-source="/initial"/>
      <collection id="rows" source="/rows" item-key="/id" paging="client" page-size="10"/>
      <log-table source="/log"><column label="Value" source="@item/value"/></log-table>`),
  };
  const result = validateOvenData(oven, { tabs: {}, initial: "a", rows: {}, log: {} });

  assert.deepEqual(result.errors, ["/tabs", "/rows", "/log"].map((path) => ({
    path,
    message: "Oven source pointer must resolve to an array.",
  })));
});

test("every lowered array consumer rejects wrong shapes and optional absence", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <kpi-strip><kpi-item><burn-donut source="/burns" optional="true"/></kpi-item></kpi-strip>
      <diff-card source="/cards" optional="true"/>
      <differential-log-table source="/entries" optional="true"/>
      <progress-chart source="/history" optional="true"/>
      <image-triptych>
        <bind prop="images" source="/images" optional="true"/>
        <bind prop="label" source="/label"/>
        <bind prop="frame" source="/frame"/>
      </image-triptych>
      <feed-list>
        <bind prop="feeds" source="/feeds" optional="true"/>
        <bind prop="error" source="/error"/>
        <bind prop="loading" source="/loading"/>
        <bind prop="showRepository" source="/showRepository"/>
      </feed-list>`),
  };
  const scalars = {
    burns: {}, cards: {}, entries: {}, history: {}, images: {}, feeds: {},
    label: "x", frame: 1, error: "", loading: false, showRepository: false,
  };

  assert.deepEqual(validateOvenData(oven, scalars).errors, [
    "/burns", "/cards", "/entries", "/history", "/images", "/feeds",
  ].map((path) => ({ path, message: "Oven source pointer must resolve to an array." })));
  assert.deepEqual(validateOvenData(oven, {
    label: "x", frame: 1, error: "", loading: false, showRepository: false,
  }).errors.map((error) => error.path), [
    "/burns", "/cards", "/entries", "/history", "/images", "/feeds",
  ]);
});

test("missing control fallback pointers and search fields are tolerated", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <domain-tabs id="tabs" source="/tabs" initial-source="/initial"/>
      <field-toolbar id="tools">
        <search id="query" placeholder="Find" aria-label="Find" match-fields="/missing"/>
        <sort-toggle id="sort" key="changed" label="Changed" initial="off"
          requires-source="/availability/changed" requires-value="true"/>
      </field-toolbar>
      <collection id="rows" source="/rows" item-key="/id" search-from="query" paging="client" page-size="10"/>`),
  };

  assert.equal(validateOvenData(oven, { tabs: ["a"], rows: [{ id: "row" }] }).ok, true);
});

test("selection-scoped bindings resolve against every selectable value", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <domain-tabs id="tabs" source="/domains" initial-source="/initial"/>
      <metric-tiles source="/byDomain" selection-from="tabs">
        <bind prop="passed" source="/summary/passed"/>
        <bind prop="total" source="/summary/total"/>
        <bind prop="ratio" source="/summary/ratio"/>
        <bind prop="meanAbsoluteDelta" source="/summary/mean"/>
        <bind prop="maximumAbsoluteDelta" source="/summary/max"/>
      </metric-tiles>
      <domain-note source="/byDomain" selection-from="tabs">
        <bind prop="isTarget" source="/note/isTarget"/>
        <bind prop="rationale" source="/note/rationale"/>
      </domain-note>
      <frame-card source="/byDomain" selection-from="tabs"/>`),
  };
  const domain = (rationale) => ({
    summary: { passed: 1, total: 1, ratio: 1, mean: 0, max: 0 },
    note: { isTarget: true, ...(rationale === undefined ? {} : { rationale }) },
  });
  const payload = { domains: ["a", { id: "b" }], initial: "a", byDomain: { a: domain("A"), b: domain("B") } };

  assert.equal(validateOvenData(oven, payload).ok, true);
  const invalid = validateOvenData(oven, {
    ...payload,
    byDomain: { a: domain("A"), b: domain() },
  });
  assert.deepEqual(invalid.errors, [{
    path: "/note/rationale",
    message: 'Oven source pointer does not resolve for selection "b".',
  }]);

  const missingScope = validateOvenData(oven, {
    ...payload,
    byDomain: { a: domain("A") },
  });
  assert.deepEqual(missingScope.errors, [{
    path: "/byDomain",
    message: 'Oven source pointer does not resolve for selection "b".',
  }]);

  const optionalFrame = {
    id: "custom-shape",
    oven: customSource(`
      <domain-tabs id="tabs" source="/domains"/>
      <frame-card source="/byDomain" optional="true" selection-from="tabs"/>`),
  };
  assert.deepEqual(validateOvenData(optionalFrame, { domains: ["a"] }).errors.map((error) => error.path), [
    "/byDomain",
  ]);
});

test("literal pointers inside item subtrees resolve against the static runtime wrapper", () => {
  const unwrapped = {
    id: "custom-shape",
    oven: customSource(`
      <collection id="rows" source="/rows" item-key="/id" paging="client" page-size="10">
        <each><kpi-item source="@item/value" optional="true" heading="/rootHeading"/></each>
      </collection>`),
  };
  const payload = { rootHeading: "Rows", rows: [{ id: "a", itemTitle: "Item" }] };
  assert.deepEqual(validateOvenData(unwrapped, payload).errors, [{
    path: "/rootHeading",
    message: "Oven source pointer does not resolve for collection item 0.",
  }]);

  const wrapped = {
    id: "custom-shape",
    oven: customSource(`
      <collection id="rows" source="/rows" item-key="/id" paging="client" page-size="10">
        <each><kpi-item heading="/__ovenRoot/rootHeading" title="/__ovenItem/itemTitle"/></each>
      </collection>`),
  };
  assert.equal(validateOvenData(wrapped, payload).ok, true);
});

test("validation follows the effective lowered binding after shadowing", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource(`
      <stack><kpi-item source="/shadowed-source" value="/shadowed-literal">
        <bind prop="value" source="/shadowed-bind"/>
        <text slot="value" source="/effective"/>
      </kpi-item></stack>`),
  };

  assert.equal(validateOvenData(oven, { effective: "shown" }).ok, true);
  assert.deepEqual(validateOvenData(oven, {}).errors.map((error) => error.path), ["/effective"]);
});

test("identical effective pointer diagnostics are deduplicated", () => {
  const oven = {
    id: "custom-shape",
    oven: customSource('<kpi-strip title="/same" aria-label="/same"/>'),
  };

  assert.deepEqual(validateOvenData(oven, {}).errors, [{
    path: "/same",
    message: "Oven source pointer does not resolve in the payload.",
  }]);
});

test("optional pointers may be absent but fallback alone is still required", () => {
  const optional = {
    id: "custom-shape",
    oven: customSource(`
      <stack><kpi-item source="/optional-value" optional="true">
        <bind prop="title" source="/optional-title" optional="true" fallback="Untitled"/>
        <text slot="value" source="/optional-text" optional="true" fallback="—"/>
      </kpi-item></stack>
      <log-table source="/rows"><column label="Note" source="@item/note" optional="true" fallback="—"/></log-table>`),
  };
  assert.equal(validateOvenData(optional, { rows: [{}] }).ok, true);

  const required = {
    id: "custom-shape",
    oven: customSource('<stack><kpi-item source="/required" fallback="—"/></stack>'),
  };
  assert.deepEqual(validateOvenData(required, {}).errors.map((error) => error.path), ["/required"]);
});

test("invalid custom RFC 6901 sources return structured compile errors", () => {
  const result = validateOvenData({
    id: "custom-shape",
    oven: customSource('<progress-donut source="/bad~2pointer"/>'),
  }, {});

  assert.equal(result.ok, false);
  assert.equal(result.authority, "shape-only");
  assert.ok(result.errors.some((error) => error.code === "SCALAR_POINTER"));
  assert.deepEqual(result.warnings, [SHAPE_ONLY_WARNING]);
});

test("the dispatcher contains no schema validation or per-Oven id table", () => {
  const source = readFileSync(fileURLToPath(new URL("./oven-data-validate.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /data\.schema|json[ -]?schema/iu);
  for (const id of ["differential-testing", "model-lab", "performance-tracing", "visual-parity"]) {
    for (const quote of ['"', "'", "`"]) assert.equal(source.includes(`${quote}${id}${quote}`), false, id);
  }
});
