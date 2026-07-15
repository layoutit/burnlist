import assert from "node:assert/strict";
import test from "node:test";

import { assertCard, assertManifest, STREAMING_DIFF_CONTRACT_LIMITS, STREAMING_DIFF_DATA_CONTRACT, StreamingDiffDataValidationError, validateCard, validateManifest } from "./streaming-diff-data-contract.mjs";

const card = Object.freeze({
  revId: "r-0123456789abcdef01234567",
  toolUseId: "tool-fixture",
  ts: "2026-07-15T09:00:00.000Z",
  status: "captured",
  files: [{ path: "src/example.mjs", kind: "modified", diff: "--- a/src/example.mjs\n+++ b/src/example.mjs\n@@ -1,1 +1,1 @@\n-before\n+after" }],
});

const manifest = Object.freeze({
  contract: STREAMING_DIFF_DATA_CONTRACT,
  identity: { logicalRepoKey: "logical-fixture", worktreeKey: "worktree-fixture", session: "session-fixture" },
  generation: "g-0123456789abcdef01234567",
  updatedAt: "2026-07-15T09:01:00.000Z",
  revs: [card.revId],
});

test("the @2 golden card and manifest survive a JSON round trip", () => {
  const roundTrippedCard = JSON.parse(JSON.stringify(card));
  const roundTrippedManifest = JSON.parse(JSON.stringify(manifest));
  assert.equal(validateCard(roundTrippedCard).ok, true);
  assert.equal(validateManifest(roundTrippedManifest).ok, true);
  assert.equal(assertCard(roundTrippedCard), roundTrippedCard);
  assert.equal(assertManifest(roundTrippedManifest), roundTrippedManifest);
});

test("the @2 contract rejects version negotiation, unknown fields, and oversized collections", () => {
  const wrongVersion = { ...manifest, contract: "burnlist-streaming-diff-data@1" };
  const unknownField = { ...card, sequence: 1 };
  assert.match(validateManifest(wrongVersion).issues[0].message, /upgrade or restart/u);
  assert.ok(validateCard(unknownField).issues.some((issue) => issue.path === "$.sequence"));
  assert.throws(() => assertManifest(wrongVersion), StreamingDiffDataValidationError);
  assert.ok(validateCard({ ...card, files: Array.from({ length: STREAMING_DIFF_CONTRACT_LIMITS.maxFiles + 1 }, () => card.files[0]) }).issues.some((issue) => issue.path === "$.files"));
  assert.ok(validateCard({ ...card, files: Array.from({ length: STREAMING_DIFF_CONTRACT_LIMITS.maxFiles }, (_, index) => ({ path: `src/${index}.mjs`, kind: "modified", diff: "x".repeat(9_000) })) }).issues.some((issue) => issue.path === "$"));
  assert.ok(validateManifest({ ...manifest, revs: Array.from({ length: STREAMING_DIFF_CONTRACT_LIMITS.maxRevs + 1 }, (_, index) => `r-${index.toString(16).padStart(24, "0")}`) }).issues.some((issue) => issue.path === "$.revs"));
});

test("redacted metadata entries require both redacted truth and a reason", () => {
  const redacted = { path: "safe.txt", kind: "redacted", meta: { redacted: true, reason: "secret-looking value" } };
  const partial = { ...card, status: "partial", partialReason: "content withheld/incomplete", files: [redacted] };
  assert.equal(validateCard(partial).ok, true);
  assert.ok(validateCard({ ...card, files: [{ ...redacted, meta: { reason: "secret-looking value" } }] }).issues.some((issue) => issue.path.endsWith(".redacted")));
  assert.ok(validateCard({ ...card, files: [{ ...redacted, meta: { redacted: true } }] }).issues.some((issue) => issue.path.endsWith(".reason")));
  assert.ok(validateCard({ ...card, files: [{ path: "src\\escape.mjs", kind: "modified", diff: "x" }] }).issues.some((issue) => issue.path.endsWith(".path")));
});

test("captured cards cannot contain denied or otherwise incomplete file entries", () => {
  const denied = { ...card, files: [{ path: "private.env", kind: "denied" }] };
  const result = validateCard(denied);

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.path === "$.status" && /partial/u.test(issue.message)));
  assert.throws(() => assertCard(denied), StreamingDiffDataValidationError);
});

test("a captured binary metadata entry is complete", () => {
  const binary = { ...card, files: [{ path: "image.png", kind: "binary", meta: { bytes: 12 } }] };

  assert.equal(validateCard(binary).ok, true);
});

test("a pre-hook attempt marker is a valid empty partial card", () => {
  const attempt = { ...card, status: "partial", partialReason: "attempt in progress / unterminated", files: [] };
  assert.equal(validateCard(attempt).ok, true);
});
