import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexAppServerError,
  createCodexAppServerClient,
  resolveCodexAppServerLaunch,
} from "./codex-app-server-client.mjs";

const fakeServer = `
  import readline from "node:readline";
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (!Object.hasOwn(message, "id")) return;
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "fixture" } }) + "\\n");
    } else if (message.method === "thread/read") {
      process.stdout.write(JSON.stringify({
        id: message.id,
        result: { thread: { id: message.params.threadId, status: { type: "idle" }, turns: [] } },
      }) + "\\n");
    } else {
      process.stdout.write(JSON.stringify({
        id: message.id,
        error: { code: -1, message: "fixture rejection", data: { fixture: true } },
      }) + "\\n");
    }
  });
`;

const approvalServer = `
  import readline from "node:readline";
  const lines = readline.createInterface({ input: process.stdin });
  let readRequest = null;
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "fixture" } }) + "\\n");
    } else if (message.method === "thread/read") {
      readRequest = message;
      process.stdout.write(JSON.stringify({
        id: "approval-1",
        method: "item/commandExecution/requestApproval",
        params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", command: "npm test" },
      }) + "\\n");
    } else if (message.id === "approval-1" && readRequest) {
      process.stdout.write(JSON.stringify({
        id: readRequest.id,
        result: { thread: { id: "thread-1", status: { type: "idle" }, turns: [] } },
      }) + "\\n");
    }
  });
`;

function fixtureLaunch() {
  return {
    command: process.execPath,
    args: ["--input-type=module", "-e", fakeServer],
    mode: "isolated",
    socket: null,
  };
}

function scriptLaunch(source) {
  return {
    command: process.execPath,
    args: ["--input-type=module", "-e", source],
    mode: "shared",
    socket: "/tmp/fixture.sock",
  };
}

test("Codex App Server launch resolves shared proxy and an explicit binary", () => {
  assert.deepEqual(resolveCodexAppServerLaunch({
    env: { BURNLIST_CODEX_BIN: "/opt/codex" },
    fileExists: () => false,
    platform: "linux",
    socket: "/tmp/codex.sock",
  }), {
    command: "/opt/codex",
    args: ["app-server", "proxy", "--sock", "/tmp/codex.sock"],
    mode: "shared",
    socket: "/tmp/codex.sock",
  });
});

test("Codex App Server launch discovers the installed bridge socket", () => {
  const socket = "/tmp/fixture-home/.codex/burnlist-app-server/app-server.sock";
  assert.deepEqual(resolveCodexAppServerLaunch({
    env: {},
    fileExists: (path) => path === socket,
    home: "/tmp/fixture-home",
    platform: "linux",
  }), {
    command: "codex",
    args: ["app-server", "proxy", "--sock", socket],
    mode: "shared",
    socket,
  });
});

test("Codex App Server client performs the initialize handshake and requests", async () => {
  const client = createCodexAppServerClient({ launch: fixtureLaunch(), timeoutMs: 2_000 });
  try {
    const result = await client.request("thread/read", { threadId: "thread-1", includeTurns: true });
    assert.equal(result.thread.id, "thread-1");
    assert.equal(result.thread.status.type, "idle");
  } finally {
    client.close();
  }
});

test("Codex App Server RPC rejections are definite and retain structured data", async () => {
  const client = createCodexAppServerClient({ launch: fixtureLaunch(), timeoutMs: 2_000 });
  try {
    await assert.rejects(
      client.request("fixture/reject", {}),
      (error) => {
        assert.ok(error instanceof CodexAppServerError);
        assert.equal(error.code, "CODEX_RPC_REJECTED");
        assert.equal(error.definite, true);
        assert.equal(error.message, "Codex App Server rejected the request.");
        assert.equal(error.diagnostic, "fixture rejection");
        assert.deepEqual(error.data, { fixture: true });
        return true;
      },
    );
  } finally {
    client.close();
  }
});

test("Codex App Server server requests are answered by the registered owner", async () => {
  const client = createCodexAppServerClient({
    launch: scriptLaunch(approvalServer),
    timeoutMs: 2_000,
  });
  const observed = [];
  const stop = client.onServerRequest((message) => {
    observed.push(message);
    client.respondServerRequest(message.id, { decision: "accept" });
    return true;
  });
  try {
    const result = await client.request("thread/read", { threadId: "thread-1" });
    assert.equal(result.thread.id, "thread-1");
    assert.equal(observed[0].method, "item/commandExecution/requestApproval");
  } finally {
    stop();
    client.close();
  }
});

test("unowned Codex App Server requests fail closed instead of stalling", async () => {
  const client = createCodexAppServerClient({
    launch: scriptLaunch(approvalServer),
    timeoutMs: 2_000,
  });
  try {
    const result = await client.request("thread/read", { threadId: "thread-1" });
    assert.equal(result.thread.status.type, "idle");
  } finally {
    client.close();
  }
});
