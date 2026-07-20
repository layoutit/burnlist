import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const runtimePath = new URL("./oven-live-data.ts", import.meta.url).pathname;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (payload, etag = "v1") => ({
  ok: true,
  status: 200,
  headers: { get: (name) => name === "etag" ? etag : null },
  json: async () => payload,
});
const notModified = {
  ok: false,
  status: 304,
  headers: { get: (name) => name === "etag" ? "v1" : null },
  json: async () => { throw new Error("no body on 304"); },
};

test("oven poller treats an unchanged ETag response as a successful no-op", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".oven-live-data-304-test-"));
  try {
    const runtimeOutput = join(outputDir, "oven-live-data.mjs");
    await build({
      entryPoints: [runtimePath],
      bundle: true,
      format: "esm",
      outfile: runtimeOutput,
      packages: "external",
      platform: "node",
      target: "node18",
    });
    const { createOvenPoller } = await import(`${pathToFileURL(runtimeOutput).href}?test=${Date.now()}`);
    const actions = [], calls = [];
    let request = 0;
    const poller = createOvenPoller({
      id: "sample",
      dispatch: (action) => actions.push(action),
      fetchImpl: async (_url, init) => {
        calls.push(init);
        request += 1;
        if (request === 1) return response({ version: 1 });
        if (request === 2) return notModified;
        return response({ version: 2 }, "v2");
      },
    });

    poller.refresh();
    await settle();
    assert.equal(actions.filter((action) => action.type === "payloadAccepted").length, 1);

    poller.refresh();
    await settle();
    assert.deepEqual(calls[1].headers, { "If-None-Match": "v1" });
    assert.equal(actions.some((action) => action.type === "payloadRejected"), false);

    poller.refresh();
    await settle();
    assert.deepEqual(calls[2].headers, { "If-None-Match": "v1" });
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
