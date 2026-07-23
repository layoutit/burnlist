import assert from "node:assert/strict";
import test from "node:test";
import { interactiveBinaryPath, runInteractiveCli } from "./interactive-cli.mjs";

test("interactive mode launches the compiled TUI and forwards its options", () => {
  const calls = [];
  const status = runInteractiveCli({
    args: ["-i", "--server", "http://127.0.0.1:4510"],
    packageRoot: "/package",
    platform: "linux",
    exists: () => true,
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(calls, [[
    interactiveBinaryPath("/package", "linux"),
    ["--server", "http://127.0.0.1:4510"],
    { stdio: "inherit", shell: false },
  ]]);
});

test("interactive mode explains how to build a missing executable", () => {
  const errors = [];
  const status = runInteractiveCli({
    args: ["-i"],
    packageRoot: "/package",
    exists: () => false,
    error: (message) => errors.push(message),
  });
  assert.equal(status, 1);
  assert.match(errors[0], /npm run build:tui/u);
  assert.match(errors[0], /burnlist -i/u);
});
