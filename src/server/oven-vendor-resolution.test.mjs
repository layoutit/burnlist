import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { writeVendoredOven } from "./oven-vendor.mjs";
import { httpGet, withServer } from "./dashboard-routes-fixtures.mjs";

const id = "checklist";
const instructions = "# Vendored Checklist\n\nUse the repository copy.\n";
const oven = `<oven id="${id}" version="7.8.9" contract="checklist-progress@1" theme="checklist">
  <section-header title="Vendored Checklist"/>
</oven>
`;

test("a repo vendored Oven is served ahead of the shipped built-in", { timeout: 20_000 }, async () => {
  await withServer({
    withBurnlist: true,
    setup: async ({ fixtureRoot }) => {
      writeVendoredOven(join(fixtureRoot, "fixture-repo"), { id, instructions, oven });
    },
  }, async ({ baseUrl }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body).ovens;
    const vendored = catalog.find((entry) => entry.id === id && entry.repoKey !== null);
    assert.ok(vendored);
    const response = await httpGet(baseUrl, `/api/ovens/${id}?repoKey=${vendored.repoKey}`);
    assert.equal(response.status, 200);
    const served = JSON.parse(response.body).oven;
    assert.equal(served.instructions, instructions);
    assert.equal(served.oven, oven);
    assert.equal(served.ir.version, "7.8.9");
  });
});
