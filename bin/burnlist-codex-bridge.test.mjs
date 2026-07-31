import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeLaunchArgs,
  defaultBridgeSocket,
  realCodexBinary,
} from "./burnlist-codex-bridge.mjs";

test("Codex bridge derives one stable local socket", () => {
  assert.equal(
    defaultBridgeSocket({}, "/tmp/fixture-home"),
    "/tmp/fixture-home/.codex/burnlist-app-server/app-server.sock",
  );
  assert.equal(
    defaultBridgeSocket({ BURNLIST_CODEX_APP_SERVER_SOCKET: "/tmp/shared.sock" }, "/unused"),
    "/tmp/shared.sock",
  );
});

test("Codex bridge preserves Desktop config while replacing stdio with server and proxy", () => {
  assert.deepEqual(bridgeLaunchArgs([
    "-c",
    "features.code_mode_host=true",
    "app-server",
    "--analytics-default-enabled",
  ], "/tmp/shared.sock"), {
    server: [
      "-c",
      "features.code_mode_host=true",
      "app-server",
      "--analytics-default-enabled",
      "--listen",
      "unix:///tmp/shared.sock",
    ],
    proxy: [
      "-c",
      "features.code_mode_host=true",
      "app-server",
      "proxy",
      "--sock",
      "/tmp/shared.sock",
    ],
  });
  assert.equal(bridgeLaunchArgs(["--version"], "/tmp/shared.sock"), null);
});

test("Codex bridge removes every inherited transport before adding its Unix socket", () => {
  assert.deepEqual(bridgeLaunchArgs([
    "app-server",
    "--listen",
    "stdio://",
    "--listen=ws://127.0.0.1:4500",
    "--stdio",
    "--analytics-default-enabled",
  ], "/tmp/shared.sock").server, [
    "app-server",
    "--analytics-default-enabled",
    "--listen",
    "unix:///tmp/shared.sock",
  ]);
});

test("Codex bridge binary override never reads CODEX_CLI_PATH recursively", () => {
  assert.equal(realCodexBinary({
    BURNLIST_CODEX_BIN: "/opt/codex",
    CODEX_CLI_PATH: "/opt/burnlist-codex-bridge",
  }, "linux"), "/opt/codex");
  assert.equal(realCodexBinary({ CODEX_CLI_PATH: "/opt/burnlist-codex-bridge" }, "linux"), "codex");
});
