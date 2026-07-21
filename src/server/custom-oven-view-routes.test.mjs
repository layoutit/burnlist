import assert from "node:assert/strict";
import test from "node:test";
import { httpGet, withServer } from "./dashboard-routes-fixtures.mjs";

const ovenSource = `<oven id="widget-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <kpi-strip>
    <kpi-item variant="current" heading="Widget" title="/widget/name" value="/widget/count"/>
  </kpi-strip>
</oven>`;

test("a custom Oven view serves compiled IR and author-shaped bound data", { timeout: 20_000 }, async () => {
  const payload = { widget: { name: "Sprockets", count: 42 } };
  await withServer({
    ovens: [{ id: "widget-oven", oven: ovenSource }],
    ovenData: [{ id: "widget-oven", payload }],
  }, async ({ baseUrl }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const repoKey = catalog.ovens.find((oven) => oven.id === "widget-oven")?.repoKey;
    assert.ok(repoKey);
    const query = `?repoKey=${encodeURIComponent(repoKey)}`;

    const ovenResponse = await httpGet(baseUrl, `/api/ovens/widget-oven${query}`);
    assert.equal(ovenResponse.status, 200);
    assert.equal(JSON.parse(ovenResponse.body).oven.ir.id, "widget-oven");

    const dataResponse = await httpGet(baseUrl, `/api/oven-data/widget-oven${query}`);
    assert.equal(dataResponse.status, 200);
    assert.deepEqual(JSON.parse(dataResponse.body).payload, payload);
    assert.equal(JSON.parse(dataResponse.body).validated, false);

    const viewResponse = await httpGet(baseUrl, `/r/${encodeURIComponent(repoKey)}/o/widget-oven`);
    assert.equal(viewResponse.status, 200);
    assert.ok(viewResponse.body.length > 0);
  });
});
