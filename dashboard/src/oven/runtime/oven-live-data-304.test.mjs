import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const runtimePath = new URL("./oven-live-data.ts", import.meta.url).pathname;

test("the declarative runtime maps a shared 304 to an unchanged reducer generation", async () => {
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
    const { subscribeOvenRuntimeSnapshot } = await import(`${pathToFileURL(runtimeOutput).href}?test=${Date.now()}`);
    let listener;
    const client = {
      subscribe(_descriptor, nextListener) {
        listener = nextListener;
        return { refresh() {}, unsubscribe() {} };
      },
    };
    const actions = [];
    subscribeOvenRuntimeSnapshot({
      client,
      id: "sample",
      search: "",
      dispatch: (action) => actions.push(action),
    });
    listener({ data: null, error: "", generation: 10, outcome: "loading" });
    listener({ data: { version: 1 }, error: "", generation: 10, outcome: "accepted" });
    listener({ data: { version: 1 }, error: "", generation: 11, outcome: "loading" });
    listener({ data: { version: 1 }, error: "", generation: 11, outcome: "unchanged" });

    assert.deepEqual(actions, [
      { type: "payloadRequested", generation: 10 },
      { type: "payloadAccepted", payload: { version: 1 }, generation: 10 },
      { type: "payloadRequested", generation: 11 },
      { type: "payloadUnchanged", generation: 11 },
    ]);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
