import assert from "node:assert/strict";
import test from "node:test";

import { explicitServer, probeRuntime, serviceServerArgs, stopRuntime } from "./supervisor.mjs";

const runtime = {
  url: "http://127.0.0.1:4510/",
  instanceId: "instance",
  version: "1.2.3",
  token: "secret",
};

test("explicit server parsing preserves the override", () => {
  assert.equal(explicitServer(["-i", "--server", "http://127.0.0.1:9999"]), "http://127.0.0.1:9999");
  assert.equal(explicitServer(["-i"]), null);
  assert.throws(() => explicitServer(["-i", "--server"]), /requires a URL/u);
});

test("the shared service owns stable port 4510 while ephemeral services auto-select", () => {
  const shared = serviceServerArgs("/package", "/state", "shared");
  const ephemeral = serviceServerArgs("/package", "/state", "ephemeral");
  assert.deepEqual(shared.slice(-4), ["--port", "4510", "--state-dir", "/state"]);
  assert.deepEqual(ephemeral.slice(-5), ["--port", "0", "--state-dir", "/state", "--auto-port"]);
});

test("runtime probing requires matching loopback identity and version", async () => {
  const fetchImpl = async () => Response.json({
    schema: "burnlist-service@1",
    instanceId: "instance",
    version: "1.2.3",
  });
  assert.ok(await probeRuntime(runtime, { fetchImpl }));
  assert.equal(await probeRuntime({ ...runtime, url: "https://example.com" }, { fetchImpl }), null);
  assert.equal(await probeRuntime(runtime, { fetchImpl: async () => Response.json({
    schema: "burnlist-service@1",
    instanceId: "other",
    version: "1.2.3",
  }) }), null);
});

test("shutdown uses the exact runtime token", async () => {
  const calls = [];
  let stopped = false;
  const fetchImpl = async (url, options = {}) => {
    calls.push([String(url), options]);
    if (String(url).endsWith("/api/health")) {
      if (stopped) throw new Error("stopped");
      return Response.json({
      schema: "burnlist-service@1",
      instanceId: "instance",
      version: "1.2.3",
      });
    }
    stopped = true;
    return new Response("", { status: 202 });
  };
  assert.equal(await stopRuntime(runtime, { fetchImpl }), true);
  assert.equal(calls[1][1].headers["x-burnlist-service-token"], "secret");
});
