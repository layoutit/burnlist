import assert from "node:assert/strict";
import test from "node:test";

import { createMultiMonitorServerRequestBroker } from "./multi-monitor-server-requests.mjs";

const identity = {
  logicalRepoKey: "aaaaaaaaaaaa",
  worktreeKey: "bbbbbbbbbbbb",
  session: "thread-1",
};

function harness() {
  const at = Date.parse("2026-07-30T12:00:00.000Z");
  const responses = [];
  const timers = [];
  let serverListener = null;
  const controller = {
    onNotification() { return () => {}; },
    onServerRequest(listener) { serverListener = listener; return () => { serverListener = null; }; },
    respondServerRequest(id, result) { responses.push({ id, result }); },
  };
  const broker = createMultiMonitorServerRequestBroker({
    controller,
    resolveTarget: async () => ({
      provider: "codex",
      threadSource: "user",
      threadId: "thread-1",
      topLevel: true,
    }),
    random: () => "browser-request-1",
    now: () => at,
    setTimer(callback) {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  return { broker, responses, serverListener, timers };
}

test("Codex command approvals are surfaced and resolved on the originating RPC request", async () => {
  const value = harness();
  assert.equal(value.serverListener({
    id: 91,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      command: "npm test",
      cwd: "/repo",
    },
  }), true);
  assert.deepEqual(await value.broker.list(identity), [{
    requestId: "browser-request-1",
    kind: "command",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    reason: "",
    detail: "npm test",
    cwd: "/repo",
    serverName: "",
    url: "",
    questions: [],
    createdAt: "2026-07-30T12:00:00.000Z",
  }]);
  const receipt = await value.broker.respond({
    identity,
    requestId: "browser-request-1",
    action: "accept",
  });
  assert.equal(receipt.status, "resolved");
  assert.deepEqual(value.responses, [{ id: 91, result: { decision: "accept" } }]);
  assert.deepEqual(await value.broker.list(identity), []);
});

test("unanswered requests fail closed when their bounded lifetime expires", async () => {
  const value = harness();
  value.serverListener({
    id: "approval-2",
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-2" },
  });
  value.timers[0].callback();
  assert.deepEqual(value.responses, [{
    id: "approval-2",
    result: { decision: "decline" },
  }]);
  assert.deepEqual(await value.broker.list(identity), []);
});
