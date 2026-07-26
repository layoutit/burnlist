import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { currentRunAuthority } from "./current-authority.mjs";

const runId = "run:01arz3ndektsv4rrffq69g5fav", itemRef = "item:260722-001#M8", assignmentId = `as1-sha256:${"a".repeat(64)}`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-current-authority-")), base = join(root, ".local", "burnlist", "loop", "m2");
  mkdirSync(base, { recursive: true }); t.after(() => rmSync(root, { recursive: true, force: true })); return { root, base, authority: () => currentRunAuthority({ root, base, random: () => Buffer.from("12345678") }) };
}
function entry() { return { itemRef, runId, assignmentId }; }

test("current Run authority publishes canonical private records and rejects malformed bounds", (t) => {
  const value = fixture(t), authority = value.authority(); authority.write([entry()]);
  assert.deepEqual(authority.read(), [entry()]); const target = authority.target;
  chmodSync(target, 0o644); assert.throws(() => authority.read(), /unsafe/u); chmodSync(target, 0o600);
  writeFileSync(target, Buffer.alloc(65_537), { mode: 0o600 }); assert.throws(() => authority.read(), /unsafe/u);
  writeFileSync(target, "{}\n", { mode: 0o600 }); assert.throws(() => authority.read(), /canonical/u);
  writeFileSync(target, `${JSON.stringify({ schema: "burnlist-loop-current-runs@1", items: [entry(), entry()] })}\n`, { mode: 0o600 }); assert.throws(() => authority.read(), /unordered or duplicate/u);
});

test("current Run authority rejects leaf and ancestor symlink substitution", (t) => {
  const value = fixture(t), authority = value.authority(), outside = join(value.root, "outside"); authority.write([entry()]); mkdirSync(outside);
  rmSync(authority.target); symlinkSync(join(outside, "missing"), authority.target); assert.throws(() => authority.read(), /unsafe/u); rmSync(authority.target);
  const moved = `${value.base}.moved`; renameSync(value.base, moved); symlinkSync(outside, value.base, "dir"); assert.throws(() => authority.read(), /ancestor is unsafe/u);
});
