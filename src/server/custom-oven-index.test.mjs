import assert from "node:assert/strict";
import test from "node:test";
import { httpGet, withServer } from "./dashboard-routes-fixtures.mjs";

const ovenSource = `<oven id="widget-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <kpi-strip>
    <kpi-item variant="current" heading="Widget" title="/widget/name" value="/widget/count"/>
  </kpi-strip>
</oven>`;

test("a bound custom Oven appears in the dashboard index with a working data selection", { timeout: 20_000 }, async () => {
  await withServer({
    ovens: [{ id: "widget-oven", oven: ovenSource }],
    ovenData: [{ id: "widget-oven", payload: { widget: { name: "Sprockets", count: 42 } } }],
  }, async ({ baseUrl }) => {
    const burnlists = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    const entry = burnlists.find((candidate) => candidate.ovenId === "widget-oven");
    assert.ok(entry);
    assert.match(entry.href, /^\/ovens\/widget-oven\/view\?repoKey=/u);

    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const oven = catalog.ovens.find((candidate) => candidate.id === "widget-oven");
    assert.ok(oven?.repoKey);
    assert.notEqual(entry.repoKey, null);
    assert.equal(entry.repoKey, oven.repoKey);

    const repoKey = new URL(entry.href, baseUrl).searchParams.get("repoKey");
    assert.equal(repoKey, oven.repoKey);
    assert.equal((await httpGet(baseUrl, `/api/oven-data/widget-oven?repoKey=${encodeURIComponent(repoKey)}`)).status, 200);
  });
});
