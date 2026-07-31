import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexAppServerError } from "./codex-app-server-client.mjs";
import {
  createCodexMessageController,
  createMultiMonitorMessageProtocol,
  MULTI_MONITOR_MESSAGE_CONTRACT,
} from "./multi-monitor-messages.mjs";

const identity = {
  logicalRepoKey: "aaaaaaaaaaaa",
  worktreeKey: "bbbbbbbbbbbb",
  session: "019f9426-6dde-7293-a57a-163f81e195cb",
};
const requestId = "019fb4c7-c14e-7600-8ef0-5f0736bc4e75";

function target(repoRoot, overrides = {}) {
  return {
    repoRoot,
    threadId: identity.session,
    provider: "codex",
    threadSource: "user",
    topLevel: true,
    turnOpen: false,
    caughtUp: true,
    ...overrides,
  };
}

function protocol(repoRoot, client, overrides = {}) {
  return createMultiMonitorMessageProtocol({
    controller: createCodexMessageController({ client }),
    resolveTarget: () => target(repoRoot, overrides),
  });
}

function request(message = "Ship the exact fix.") {
  return { identity, message, requestId };
}

function fixture(testBody) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-multi-monitor-message-"));
  return Promise.resolve().then(() => testBody(root)).finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
}

test("shared Codex delivery starts an idle real turn and replays its durable receipt", () => fixture(async (root) => {
  const calls = [];
  const client = {
    mode: "shared",
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/read") {
        return { thread: { id: identity.session, status: { type: "notLoaded" }, turns: [] } };
      }
      if (method === "thread/resume") return { thread: { id: identity.session } };
      if (method === "turn/start") {
        return { turn: { id: "turn-started", status: "inProgress", items: [] } };
      }
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const messages = protocol(root, client);
  const first = await messages.send(request());
  const second = await messages.send(request());
  assert.equal(first.contract, MULTI_MONITOR_MESSAGE_CONTRACT);
  assert.equal(first.status, "accepted");
  assert.equal(first.delivery, "started");
  assert.equal(first.turnId, "turn-started");
  assert.deepEqual(second, first);
  assert.deepEqual(calls.map((call) => call.method), ["thread/read", "thread/resume", "turn/start"]);
  const stored = JSON.parse(readFileSync(
    join(root, ".local", "burnlist", "multi-monitor-messages", `${requestId}.json`),
    "utf8",
  ));
  assert.equal(stored.status, "accepted");
  assert.equal(Object.hasOwn(stored, "message"), false);
}));

test("shared control steers the exact active turn", () => fixture(async (root) => {
  const calls = [];
  const client = {
    mode: "shared",
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/read") {
        return {
          thread: {
            id: identity.session,
            status: { type: "active", activeFlags: [] },
            turns: [{ id: "turn-live", status: "inProgress", items: [] }],
          },
        };
      }
      if (method === "turn/steer") return { turnId: "turn-live" };
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const receipt = await protocol(root, client, { turnOpen: true }).send(request());
  assert.equal(receipt.delivery, "steered");
  assert.equal(receipt.turnId, "turn-live");
  assert.equal(calls[1].params.expectedTurnId, "turn-live");
  assert.equal(calls[1].params.clientUserMessageId, requestId);
}));

test("isolated control refuses every delivery before reading or writing a task", () => fixture(async (root) => {
  const calls = [];
  const client = {
    mode: "isolated",
    async request(method) {
      calls.push(method);
      return { thread: { id: identity.session, status: { type: "notLoaded" }, turns: [] } };
    },
  };
  const messages = protocol(root, client, { turnOpen: true });
  await assert.rejects(messages.send(request()), (error) => {
    assert.equal(error.code, "SHARED_CONTROL_REQUIRED");
    assert.equal(error.status, 409);
    return true;
  });
  assert.deepEqual(calls, []);
  assert.equal(existsSync(
    join(root, ".local", "burnlist", "multi-monitor-messages", `${requestId}.json`),
  ), false);
}));

test("an ambiguous transport failure is never retried silently", () => fixture(async (root) => {
  let attempts = 0;
  const client = {
    mode: "shared",
    async request() {
      attempts += 1;
      throw new CodexAppServerError("connection lost", { code: "CODEX_CONNECTION", definite: false });
    },
  };
  const messages = protocol(root, client);
  await assert.rejects(messages.send(request()), /connection lost/u);
  await assert.rejects(messages.send(request()), (error) => {
    assert.equal(error.code, "DELIVERY_UNCERTAIN");
    return true;
  });
  assert.equal(attempts, 1);
}));

test("an in-flight delivery id cannot alias another message", () => fixture(async (root) => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const client = {
    mode: "shared",
    async request(method) {
      if (method === "thread/read") {
        await waiting;
        return { thread: { id: identity.session, status: { type: "idle" }, turns: [] } };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn-started", status: "inProgress", items: [] } };
      }
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const messages = protocol(root, client);
  const first = messages.send(request("First exact message."));
  await Promise.resolve();
  await assert.rejects(
    messages.send(request("Different message with the same id.")),
    (error) => error.code === "REQUEST_ID_REUSED" && error.status === 409,
  );
  release();
  assert.equal((await first).status, "accepted");
}));

test("non-user, subagent, and stale feeds cannot receive direct input", () => fixture(async (root) => {
  const client = { mode: "shared", async request() { throw new Error("must not send"); } };
  await assert.rejects(
    protocol(root, client, { threadSource: "subagent", topLevel: false }).send(request()),
    (error) => error.code === "DIRECT_INPUT_DENIED",
  );
  await assert.rejects(
    protocol(root, client, { caughtUp: false }).send({ ...request(), requestId: "119fb4c7-c14e-7600-8ef0-5f0736bc4e75" }),
    (error) => error.code === "FEED_NOT_CURRENT",
  );
}));

test("per-thread delivery queues reject overload instead of growing without bound", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const client = {
    mode: "shared",
    async request(method) {
      if (method === "thread/read") {
        await waiting;
        return { thread: { status: { type: "idle" }, turns: [] } };
      }
      return { turn: { id: "turn", status: "inProgress" } };
    },
  };
  const controller = createCodexMessageController({ client });
  const sends = Array.from({ length: 8 }, (_, index) =>
    controller.send(target("/repo"), `message ${index}`, `request-${index}`));
  await assert.rejects(
    Promise.resolve().then(() => controller.send(target("/repo"), "overflow", "request-9")),
    (error) => error.code === "DELIVERY_BUSY" && error.status === 429,
  );
  release();
  await Promise.all(sends);
});

test("aggregate delivery concurrency has a hard global ceiling", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const client = {
    mode: "shared",
    async request(method) {
      if (method === "thread/read") {
        await waiting;
        return { thread: { status: { type: "idle" }, turns: [] } };
      }
      return { turn: { id: "turn", status: "inProgress" } };
    },
  };
  const controller = createCodexMessageController({ client });
  const sends = Array.from({ length: 64 }, (_, index) =>
    controller.send(
      target("/repo", { threadId: `thread-${index}` }),
      `message ${index}`,
      `request-${index}`,
    ));
  await assert.rejects(
    Promise.resolve().then(() => controller.send(
      target("/repo", { threadId: "thread-overflow" }),
      "overflow",
      "request-overflow",
    )),
    (error) => error.code === "DELIVERY_BUSY" && error.status === 429,
  );
  release();
  await Promise.all(sends);
});
