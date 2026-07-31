import assert from "node:assert/strict";
import test from "node:test";

import {
  isLoopbackPeerAddress,
  withoutWriteToken,
} from "./loopback-peer.mjs";

test("controller peers must be exact IPv4 or IPv6 loopback addresses", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackPeerAddress(address), true);
  }
  for (const address of ["localhost", "127.0.0.2", "192.0.2.10", "", null]) {
    assert.equal(isLoopbackPeerAddress(address), false);
  }
});

test("remote dashboard projections never expose the controller token", () => {
  const value = { ovens: [], writeToken: "secret" };
  assert.deepEqual(withoutWriteToken(value, "203.0.113.7"), { ovens: [] });
  assert.deepEqual(withoutWriteToken(value, "::ffff:127.0.0.1"), value);
  assert.deepEqual(value, { ovens: [], writeToken: "secret" });
});
