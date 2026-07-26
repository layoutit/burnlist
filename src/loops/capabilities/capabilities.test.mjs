import assert from "node:assert/strict";
import { chmodSync, fstatSync, mkdtempSync, mkdirSync, readFileSync, readSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindCapabilitySymbols, canonicalCapabilityBytes, capabilityRevision, parseCapabilityCatalog, readCapabilityCatalog, validateCapabilityGrants } from "./contract.mjs";
import { preflightCapability, runTrustedCapability, validateCapabilityEvidence } from "./runner.mjs";
import { readTrustedCapability, trustCapability } from "./trust.mjs";
import { configRoot, localRecordPath } from "../config/store.mjs";
import { holdSnapshot, releaseSnapshot, snapshotTarget } from "./snapshot.mjs";

function temp() { const root = realpathSync(mkdtempSync(join(tmpdir(), "burnlist-loop-capability-"))); mkdirSync(join(root, ".burnlist")); mkdirSync(join(root, "src")); writeFileSync(join(root, "src", "input"), "a"); return root; }
function policy(overrides = {}) { return { id: "repo-verify", argv: [process.execPath, "-e", "process.stdout.write('ok')"], cwd: ".", environment: { inherit: ["PATH"], set: {} }, network: "deny", filesystem: { read: ["src"], write: [] }, output: { maxBytes: 1024 }, maxMilliseconds: 1000, ...overrides }; }
function grants(source, overrides = {}) { return { argv: source.argv, cwd: source.cwd, environment: source.environment, network: source.network, filesystem: source.filesystem, output: source.output, maxMilliseconds: source.maxMilliseconds, ...overrides }; }
function writeCatalog(root, capabilities = [policy()]) { writeFileSync(join(root, ".burnlist", "loop-capabilities.json"), `${JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities })}\n`); }
function trust(root) { const current = readCapabilityCatalog(root).capabilities[0]; return trustCapability({ repoRoot: root, capability: current, grants: grants(current) }); }

test("closed canonical policy binds compiler check symbols and separate narrower grants", () => {
  const root = temp(); writeCatalog(root); const current = readCapabilityCatalog(root).capabilities[0];
  assert.match(capabilityRevision(current), /^cp1-sha256:/); assert.equal(canonicalCapabilityBytes(current).toString(), `${JSON.stringify(current)}\n`);
  assert.deepEqual(bindCapabilitySymbols({ nodes: [{ kind: "check", id: "verify", capability: "repo-verify" }] }, readCapabilityCatalog(root)), [{ nodeId: "verify", capability: "repo-verify", revision: capabilityRevision(current) }]);
  const narrow = validateCapabilityGrants(grants(current, { output: { maxBytes: 8 }, maxMilliseconds: 10 }), current); assert.equal(narrow.output.maxBytes, 8);
  assert.throws(() => validateCapabilityGrants(grants(current, { filesystem: { read: ["elsewhere"], write: [] } }), current), /exceeds/);
});

test("unknown untrusted or changed policies never launch, including same-size executable replacement", () => {
  const root = temp(); writeCatalog(root); assert.throws(() => preflightCapability({ repoRoot: root, capabilityId: "missing" }), { code: "ELOOP_CAPABILITY_UNKNOWN" }); assert.throws(() => preflightCapability({ repoRoot: root, capabilityId: "repo-verify" }), { code: "ELOOP_CAPABILITY_UNTRUSTED" }); trust(root);
  const before = preflightCapability({ repoRoot: root, capabilityId: "repo-verify" }); writeCatalog(root, [policy({ argv: [process.execPath, "-e", "process.exit(0)"] })]); assert.throws(() => runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate: `cm1-sha256:${"a".repeat(64)}`, preflight: before }), { code: "ELOOP_CAPABILITY_CHANGED" });
  writeCatalog(root, [policy({ filesystem: { read: ["src/input"], write: [] } })]); trust(root); const snap = preflightCapability({ repoRoot: root, capabilityId: "repo-verify" });
  const original = snap.launch.snapshots.find((item) => item.path === process.execPath); const moved = `${process.execPath}.burnlist-test`; // immutable system executable cannot safely be renamed; exercise same snapshot API through a repo grant below.
  assert.ok(original && !moved.includes("\0")); writeFileSync(join(root, "src", "input"), "b"); assert.throws(() => runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate: `cm1-sha256:${"b".repeat(64)}`, preflight: snap }), { code: "ELOOP_CAPABILITY_CHANGED" });
  const executable = join(root, "fake-verify"); writeFileSync(executable, "#!/bin/sh\nexit 0\n"); chmodSync(executable, 0o755); writeCatalog(root, [policy({ argv: [executable], filesystem: { read: ["src/input"], write: [] } })]); trust(root); const executableSnap = preflightCapability({ repoRoot: root, capabilityId: "repo-verify" }); writeFileSync(executable, "#!/bin/sh\nexit 1\n"); assert.throws(() => runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate: `cm1-sha256:${"d".repeat(64)}`, preflight: executableSnap }), { code: "ELOOP_CAPABILITY_CHANGED" });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n"); writeCatalog(root, [policy({ argv: [executable], cwd: "src", filesystem: { read: ["src/input"], write: [] } })]); trust(root); const cwdSnap = preflightCapability({ repoRoot: root, capabilityId: "repo-verify" }); renameSync(join(root, "src"), join(root, "src-old")); mkdirSync(join(root, "src")); writeFileSync(join(root, "src", "input"), "b"); assert.throws(() => runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate: `cm1-sha256:${"e".repeat(64)}`, preflight: cwdSnap }), { code: "ELOOP_CAPABILITY_CHANGED" });
});

test("executable snapshot rejects a symlink in any absolute ancestor", () => {
  const root = temp(); const real = join(root, "real"); const link = join(root, "link"); const sub = join(real, "sub"); mkdirSync(real); mkdirSync(sub); symlinkSync(real, link);
  const executable = join(link, "sub", "tool"); writeFileSync(join(sub, "tool"), "#!/bin/sh\nexit 0\n"); chmodSync(join(sub, "tool"), 0o755);
  writeCatalog(root, [policy({ argv: [executable] })]); trust(root);
  assert.throws(() => preflightCapability({ repoRoot: root, capabilityId: "repo-verify" }), /directory ancestor/);
});

test("sealed snapshots pin exact bytes across replacement or in-place writes and close explicitly", () => {
  const root = temp(), executable = join(root, "tool");
  writeFileSync(executable, "old"); const snapshot = snapshotTarget({ root, path: executable });
  const held = holdSnapshot(snapshot); renameSync(executable, `${executable}.old`); writeFileSync(executable, "new");
  writeFileSync(`${executable}.old`, "bad");
  const bytes = Buffer.alloc(3); assert.equal(readSync(held.sealedDescriptor, bytes, 0, 3, 0), 3);
  assert.equal(bytes.toString(), "old"); assert.notEqual(fstatSync(held.sealedDescriptor).ino, snapshot.identity.ino);
  releaseSnapshot(held);
  assert.throws(() => fstatSync(held.sealedDescriptor), { code: "EBADF" });
  assert.equal(readFileSync(executable, "utf8"), "new");
});

test("private trust records use no-follow bounded descriptor reads and reject leaf or ancestor swaps", () => {
  const root = temp(); writeCatalog(root); trust(root); assert.equal(readTrustedCapability({ repoRoot: root, capability: "repo-verify", policy: readCapabilityCatalog(root).capabilities[0] }).capability, "repo-verify");
  const record = localRecordPath(root, "capabilities", "repo-verify"); const moved = `${record}.old`; renameSync(record, moved); symlinkSync(moved, record); assert.throws(() => readTrustedCapability({ repoRoot: root, capability: "repo-verify", policy: readCapabilityCatalog(root).capabilities[0] }), /regular file|symbolic link|private/);
  const ancestorRoot = temp(); writeCatalog(ancestorRoot); trust(ancestorRoot); const config = configRoot(ancestorRoot); renameSync(config, `${config}.old`); symlinkSync(`${config}.old`, config); assert.throws(() => readTrustedCapability({ repoRoot: ancestorRoot, capability: "repo-verify", policy: readCapabilityCatalog(ancestorRoot).capabilities[0] }), /directory ancestor/);
});

test("catalog rejects traversal, symlinks, environment attacks, oversize, and unsupported enforcement claims", () => {
  assert.throws(() => parseCapabilityCatalog(Buffer.from(JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [policy({ cwd: "../outside" })] }))), /cwd/);
  assert.throws(() => parseCapabilityCatalog(Buffer.from(JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [policy({ environment: { inherit: ["PATH"], set: { "BAD-NAME": "x" } } })] }))), /environment/);
  assert.throws(() => parseCapabilityCatalog(Buffer.from(JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [{ ...policy(), guarantees: { filesystem: "enforced" } }] }))), /invalid capability policy/);
  const root = temp(); writeFileSync(join(root, ".burnlist", "loop-capabilities.json"), "x".repeat(262145)); assert.throws(() => readCapabilityCatalog(root), /byte limit|invalid regular file/);
  const linkRoot = temp(); writeFileSync(join(linkRoot, "catalog"), JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [policy()] })); symlinkSync(join(linkRoot, "catalog"), join(linkRoot, ".burnlist", "loop-capabilities.json")); assert.throws(() => readCapabilityCatalog(linkRoot), /regular file|symbolic/);
  const ancestorRoot = temp(); renameSync(join(ancestorRoot, ".burnlist"), join(ancestorRoot, ".burnlist-old")); symlinkSync(join(ancestorRoot, ".burnlist-old"), join(ancestorRoot, ".burnlist")); assert.throws(() => readCapabilityCatalog(ancestorRoot), /directory ancestor/);
});

test("direct fake repo-verify has aggregate bounded output, deadline supervision, and closed capability evidence", async () => {
  const root = temp(); writeCatalog(root, [policy({ argv: [process.execPath, "-e", "process.stdout.write('out');process.stderr.write('err')"] })]); trust(root); const inputCandidate = `cm1-sha256:${"c".repeat(64)}`;
  const complete = await runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate }); assert.equal(complete.result.schema, "capability-evidence@1"); assert.equal(complete.result.outcome, "pass"); assert.equal(validateCapabilityEvidence(complete.result), complete.result); assert.match(complete.evidence.toString(), /candidate=cm1-sha256/);
  writeCatalog(root, [policy({ argv: [process.execPath, "-e", "setInterval(()=>process.stdout.write('x'),1)"], output: { maxBytes: 8 }, maxMilliseconds: 1000 })]); trust(root); const noisy = await runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate }); assert.equal(noisy.result.truncated, true); assert.equal(noisy.result.outcome, "fail"); assert.ok(noisy.evidence.length < 128);
  writeCatalog(root, [policy({ argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], maxMilliseconds: 20 })]); trust(root); const timed = await runTrustedCapability({ repoRoot: root, capabilityId: "repo-verify", inputCandidate }); assert.equal(timed.result.timedOut, true); assert.equal(timed.result.outcome, "fail");
});

test("trust creation refuses a symlinked local ancestor before recursive creation or publish", () => {
  const root = temp(); writeCatalog(root); mkdirSync(join(root, "outside")); symlinkSync(join(root, "outside"), join(root, ".local"));
  const current = readCapabilityCatalog(root).capabilities[0]; assert.throws(() => trustCapability({ repoRoot: root, capability: current, grants: grants(current) }), /unsafe trust directory/);
});
