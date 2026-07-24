import assert from "node:assert/strict";
import test from "node:test";
import { interactiveBinaryPath, interactiveTuiTargets, runInteractiveCli } from "./interactive-cli.mjs";

const packageMetadata = () => JSON.stringify({ burnlistTui: { targets: ["darwin-arm64"] } });

test("interactive mode launches the compiled TUI and forwards its options", () => {
  const calls = [];
  const status = runInteractiveCli({
    args: ["-i", "--server", "http://127.0.0.1:4510"],
    packageRoot: "/package",
    platform: "darwin",
    arch: "arm64",
    exists: () => true,
    readFile: packageMetadata,
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(calls, [[
    interactiveBinaryPath("/package", "darwin"),
    ["--server", "http://127.0.0.1:4510"],
    { stdio: "inherit", shell: false },
  ]]);
});

test("interactive mode explains how to build a missing executable", () => {
  const errors = [];
  const status = runInteractiveCli({
    args: ["-i"],
    packageRoot: "/package",
    platform: "darwin",
    arch: "arm64",
    exists: () => false,
    readFile: packageMetadata,
    error: (message) => errors.push(message),
  });
  assert.equal(status, 1);
  assert.match(errors[0], /npm run build:tui/u);
  assert.match(errors[0], /burnlist -i/u);
});

test("interactive mode declines hosts without a packaged TUI target", () => {
  const errors = [];
  const status = runInteractiveCli({
    args: ["-i"],
    packageRoot: "/package",
    platform: "linux",
    arch: "x64",
    exists: () => true,
    readFile: packageMetadata,
    spawn: () => assert.fail("unsupported host must not launch a binary"),
    error: (message) => errors.push(message),
  });
  assert.equal(status, 1);
  assert.match(errors[0], /darwin-arm64/u);
  assert.match(errors[0], /linux-x64/u);
});

test("interactive target metadata fails closed when absent or malformed", () => {
  assert.deepEqual(interactiveTuiTargets("/package", () => "{}"), []);
  assert.deepEqual(interactiveTuiTargets("/package", () => "not json"), []);
});
