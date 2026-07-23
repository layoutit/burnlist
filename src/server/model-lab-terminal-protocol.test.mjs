import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createModelLabTerminalProtocol, serveModelLabTerminalProtocol } from "./model-lab-terminal-protocol.mjs";
import { readJsonRequest } from "./read-json-request.mjs";

const controller = "controller-secret";

function state({ status = "ready", index = 2 } = {}) {
  return {
    status, ready: status === "ready", frame: { index, id: `frame-${index}`, count: 8 },
    metrics: { domNodeCount: 10, visibleLeafCount: 8, renderedLeafCount: 8, stableLeafIdentityCount: 8, childListMutationCount: 0 },
    ...(status === "error" ? { error: "surface failed" } : {}),
  };
}

async function fixture(options = {}) {
  let tick = 1_000;
  const protocol = createModelLabTerminalProtocol({ writeToken: controller, now: () => tick, random: (() => { let i = 0; return () => `${(++i).toString(16).padStart(32, "0")}`; })(), ...options });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const served = await serveModelLabTerminalProtocol({
      req, res, url, protocol, readJson: readJsonRequest,
      assertControllerWrite: (request) => {
        if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") throw Object.assign(new Error("Cross-site writes are not allowed."), { status: 403 });
        if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw Object.assign(new Error("Write origin does not match this dashboard."), { status: 403 });
        if (request.headers["x-burnlist-token"] !== controller) throw Object.assign(new Error("Missing or invalid dashboard write token."), { status: 403 });
      },
      json: (response, status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); },
    });
    if (served === false) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  async function call(path, body, token = controller, method = "POST", headers = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json", ...(token === null ? {} : { "x-burnlist-token": token }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { protocol, call, advance: (ms) => { tick += ms; }, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function session(fx) {
  const created = await fx.call("/api/model-lab-terminal/sessions", { producerId: "browser-a", ttlMs: 1_000 });
  assert.equal(created.status, 201);
  return created.body;
}

test("real fake producer publishes bounded read-only state and controller reads it", async () => {
  const fx = await fixture();
  try {
    const s = await session(fx);
    const published = await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state() }, null);
    assert.equal(published.status, 200);
    const live = await fx.call(`/api/model-lab-terminal/state?sessionId=${s.sessionId}`, undefined, controller, "GET");
    assert.deepEqual(live.body.state, state());
    assert.equal(live.body.status, "ready");
    assert.equal(Object.hasOwn(live.body.state, "producerToken"), false);
  } finally { await fx.close(); }
});

test("producer identity, controller ownership, and stale state are rejected", async () => {
  const fx = await fixture();
  try {
    const s = await session(fx);
    assert.equal((await fx.call("/api/model-lab-terminal/state?sessionId=x", undefined, null, "GET")).status, 403);
    assert.equal((await fx.call("/api/model-lab-terminal/publish", { ...s, producerId: "browser-b", sequence: 1, state: state() }, null)).status, 403);
    assert.equal((await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state() }, null)).status, 200);
    const stale = await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state({ index: 3 }) }, null);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "STALE_STATE");
  } finally { await fx.close(); }
});

test("expired sessions remain truthfully unavailable until producer reconnects", async () => {
  const fx = await fixture();
  try {
    const s = await session(fx);
    await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state() }, null);
    fx.advance(1_000);
    const unavailable = await fx.call(`/api/model-lab-terminal/state?sessionId=${s.sessionId}`, undefined, controller, "GET");
    assert.deepEqual({ status: unavailable.body.status, reason: unavailable.body.reason }, { status: "unavailable", reason: "expired" });
    const reconnected = await fx.call("/api/model-lab-terminal/reconnect", s, null);
    assert.equal(reconnected.status, 200);
    assert.equal(reconnected.body.generation, 2);
    assert.equal((await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 2, state: state() }, null)).status, 403);
    assert.equal((await fx.call("/api/model-lab-terminal/publish", { ...reconnected.body, sequence: 1, state: state({ index: 4 }) }, null)).status, 200);
  } finally { await fx.close(); }
});

test("set-frame commands are authorized, idempotent, and correlated to producer results", async () => {
  const fx = await fixture();
  try {
    const s = await session(fx);
    await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state() }, null);
    assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "r-1", command: "set-frame", frameIndex: 4 }, null)).status, 403);
    const requested = await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "r-1", command: "set-frame", frameIndex: 4 });
    assert.equal(requested.body.status, "pending");
    const delivered = await fx.call("/api/model-lab-terminal/commands/next", s, null);
    assert.deepEqual({ requestId: delivered.body.requestId, command: delivered.body.command, frameIndex: delivered.body.frameIndex }, { requestId: "r-1", command: "set-frame", frameIndex: 4 });
    assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "r-1", command: "set-frame", frameIndex: 4 })).body.replayed, true);
    assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "r-1", command: "set-frame", frameIndex: 5 })).status, 409);
    assert.equal((await fx.call("/api/model-lab-terminal/results", { ...s, requestId: "r-1", ok: true, frameIndex: 5 }, null)).status, 409);
    const result = await fx.call("/api/model-lab-terminal/results", { ...s, requestId: "r-1", ok: true, frameIndex: 4 }, null);
    assert.deepEqual(result.body.result, { ok: true, frameIndex: 4 });
    assert.equal((await fx.call("/api/model-lab-terminal/results", { ...s, requestId: "r-1", ok: true, frameIndex: 4 }, null)).body.replayed, true);
  } finally { await fx.close(); }
});

test("controller writes use the dashboard origin boundary while producer authority remains token-based", async () => {
  const fx = await fixture();
  try {
    const crossSite = { "sec-fetch-site": "cross-site", origin: "http://attacker.invalid" };
    assert.equal((await fx.call("/api/model-lab-terminal/sessions", { producerId: "browser-a" }, controller, "POST", crossSite)).status, 403);
    const s = await session(fx);
    assert.equal((await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state() }, null, "POST", crossSite)).status, 200);
    assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "cross-site", command: "set-frame", frameIndex: 1 }, controller, "POST", crossSite)).status, 403);
  } finally { await fx.close(); }
});

test("completed command replays are retained separately from the bounded pending queue", async () => {
  const fx = await fixture();
  try {
    const s = await session(fx);
    await fx.call("/api/model-lab-terminal/publish", { ...s, sequence: 1, state: state() }, null);
    for (let index = 0; index < 65; index += 1) {
      const requestId = `complete-${index}`;
      assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId, command: "set-frame", frameIndex: index % 8 })).status, 202);
      assert.equal((await fx.call("/api/model-lab-terminal/results", { ...s, requestId, ok: true, frameIndex: index % 8 }, null)).status, 200);
    }
    assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "complete-1", command: "set-frame", frameIndex: 1 })).body.replayed, true);
    for (let index = 0; index < 64; index += 1) assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: `pending-${index}`, command: "set-frame", frameIndex: index % 8 })).status, 202);
    const deliveredAgain = await fx.call("/api/model-lab-terminal/commands/next", s, null);
    assert.equal(deliveredAgain.body.requestId, "pending-0");
    assert.equal((await fx.call("/api/model-lab-terminal/commands", { sessionId: s.sessionId, requestId: "pending-overflow", command: "set-frame", frameIndex: 1 })).status, 429);
  } finally { await fx.close(); }
});

test("sessions are bounded, permit reconnect during grace, and reject after eviction", async () => {
  const fx = await fixture({ maxSessions: 2, reconnectGraceMs: 100 });
  try {
    const first = await session(fx);
    await session(fx);
    assert.equal((await fx.call("/api/model-lab-terminal/sessions", { producerId: "browser-c" })).status, 429);
    fx.advance(1_000);
    assert.equal((await fx.call("/api/model-lab-terminal/reconnect", first, null)).status, 200);
    fx.advance(1_100);
    assert.equal((await fx.call("/api/model-lab-terminal/reconnect", first, null)).status, 404);
    assert.equal((await fx.call("/api/model-lab-terminal/sessions", { producerId: "browser-c" })).status, 201);
    assert.ok(fx.protocol.sessions.size <= 2);
  } finally { await fx.close(); }
});

test("only known protocol paths claim traffic before loopback and shared reader bounds bodies", async () => {
  const protocol = createModelLabTerminalProtocol({ writeToken: controller });
  const responses = [];
  const response = { writeHead: (status) => responses.push(status), end: () => {} };
  const unrelated = await serveModelLabTerminalProtocol({
    req: { method: "GET", socket: { remoteAddress: "203.0.113.7" } }, res: response,
    url: new URL("http://dashboard.invalid/api/projects"), protocol, readJson: readJsonRequest, json: (res, status) => { res.writeHead(status); }, assertControllerWrite: () => {},
  });
  assert.equal(unrelated, false);
  const wrongMethod = await serveModelLabTerminalProtocol({
    req: { method: "GET", socket: { remoteAddress: "203.0.113.7" } }, res: response,
    url: new URL("http://dashboard.invalid/api/model-lab-terminal/sessions"), protocol, readJson: readJsonRequest, json: (res, status) => { res.writeHead(status); }, assertControllerWrite: () => {},
  });
  assert.equal(wrongMethod, undefined);
  assert.equal(responses.at(-1), 405);
  const fx = await fixture();
  try {
    assert.equal((await fx.call("/api/model-lab-terminal/sessions", { producerId: "x".repeat(262_145) })).status, 413);
  } finally { await fx.close(); }
});
