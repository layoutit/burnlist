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
    const catalogEntry = catalog.ovens.find((oven) => oven.id === "widget-oven");
    const repoKey = catalogEntry?.repoKey;
    assert.ok(repoKey);
    assert.equal(catalogEntry.origin, "custom");
    assert.equal(catalogEntry.catalogRevision, null);
    const query = `?repoKey=${encodeURIComponent(repoKey)}`;

    const ovenResponse = await httpGet(baseUrl, `/api/ovens/widget-oven${query}`);
    assert.equal(ovenResponse.status, 200);
    const definition = JSON.parse(ovenResponse.body).oven;
    assert.equal(definition.ir.id, "widget-oven");
    assert.equal(definition.version, "0.1.0");
    assert.equal(definition.contract, "checklist-progress@1");
    assert.equal(definition.dataInput, "json-payload");
    assert.equal(definition.repoKey, repoKey);
    for (const field of ["id", "name", "description", "version", "contract", "dataInput", "instructions", "oven", "ovenRevision", "ir"]) {
      assert.ok(Object.hasOwn(definition, field), `terminal definition envelope is missing ${field}`);
    }

    const dataResponse = await httpGet(baseUrl, `/api/oven-data/widget-oven${query}`);
    assert.equal(dataResponse.status, 200);
    assert.deepEqual(JSON.parse(dataResponse.body).payload, payload);
    assert.equal(JSON.parse(dataResponse.body).validated, false);

    const initial = await fetch(new URL(`/api/oven-data/widget-oven${query}`, baseUrl));
    const etag = initial.headers.get("etag");
    assert.match(etag, /^W\/"oven-json-[a-f0-9]{64}"$/u);
    const unchanged = await fetch(new URL(`/api/oven-data/widget-oven${query}`, baseUrl), {
      headers: { "If-None-Match": etag },
    });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");

    const viewResponse = await httpGet(baseUrl, `/r/${encodeURIComponent(repoKey)}/o/widget-oven`);
    assert.equal(viewResponse.status, 200);
    assert.ok(viewResponse.body.length > 0);
  });
});

test("a custom Oven rejects canonical data above the configured source limit", { timeout: 20_000 }, async () => {
  await withServer({
    ovens: [{ id: "bounded-oven" }],
    ovenData: [{ id: "bounded-oven", payload: { detail: "x".repeat(256) } }],
    serverArgs: ["--max-oven-data-bytes", "64"],
  }, async ({ baseUrl }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const repoKey = catalog.ovens.find((oven) => oven.id === "bounded-oven")?.repoKey;
    const response = await httpGet(baseUrl, `/api/oven-data/bounded-oven?repoKey=${repoKey}`);
    assert.equal(response.status, 422);
    assert.match(JSON.parse(response.body).error, /over the 64 byte limit/u);
  });
});
