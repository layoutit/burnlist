import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendCard, readJournal, reconnectFeed, resolveReconnect } from "./streaming-diff-journal.mjs";

const identity = Object.freeze({ logicalRepoKey: "logical", worktreeKey: "worktree", session: "session" });

function card(number, diff = "diff") {
  return { revId: `r-${number.toString(16).padStart(24, "0")}`, toolUseId: `tool-${number}`, ts: `2026-07-15T09:0${number}:00.000Z`, status: "captured", files: [{ path: `src/${number}.mjs`, kind: "modified", diff }] };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-journal-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("journal makes a durable card visible before its durable manifest and ignores card-first crash orphans", () => {
  const context = fixture();
  try {
    assert.throws(() => appendCard(context.root, card(1), { identity, beforeManifestSwap: () => { throw new Error("simulated crash"); } }), /simulated crash/u);
    assert.equal(existsSync(join(context.root, `rev-${card(1).revId}.json`)), true);
    assert.deepEqual(readJournal(context.root), { manifest: null, cards: [], race: false });
    const published = appendCard(context.root, card(2), { identity });
    assert.deepEqual(published.manifest.revs, [card(2).revId]);
    assert.equal(readJournal(context.root).cards[0].revId, card(2).revId);
  } finally {
    context.cleanup();
  }
});

test("an established feed rejects a card carrying a different immutable identity", () => {
  const context = fixture();
  try {
    appendCard(context.root, card(1), { identity });
    assert.throws(
      () => appendCard(context.root, card(2), { identity: { ...identity, session: "other-session" } }),
      /identity does not match/u,
    );
    assert.deepEqual(readJournal(context.root).manifest.identity, identity);
  } finally { context.cleanup(); }
});

test("retention keeps a contiguous newest suffix when a large middle card no longer fits", () => {
  const context = fixture();
  try {
    appendCard(context.root, card(1, "a"), { identity, limits: { maxRevs: 8, maxBytes: 4_096 } });
    appendCard(context.root, card(2, "b".repeat(700)), { identity, limits: { maxRevs: 8, maxBytes: 4_096 } });
    appendCard(context.root, card(3, "c"), { identity, limits: { maxRevs: 8, maxBytes: 4_096 } });
    const appended = appendCard(context.root, card(4, "d"), { identity, limits: { maxRevs: 8, maxBytes: 1_024 } });
    assert.deepEqual(appended.manifest.revs, [card(3).revId, card(4).revId]);
    for (const number of [1, 2]) assert.equal(existsSync(join(context.root, `rev-${card(number).revId}.json`)), false);
  } finally {
    context.cleanup();
  }
});

test("oversized cards become a bounded partial card before retention", () => {
  const context = fixture();
  try {
    const appended = appendCard(context.root, card(1, "x".repeat(2_000)), { identity, limits: { maxBytes: 1_024 } });
    assert.equal(appended.card.status, "partial");
    assert.deepEqual(appended.card.files, []);
  } finally {
    context.cleanup();
  }
});

test("append and reconnect self-heal manifest entries whose card vanished or mismatched", () => {
  const context = fixture();
  try {
    appendCard(context.root, card(1), { identity });
    appendCard(context.root, card(2), { identity });
    unlinkSync(join(context.root, `rev-${card(1).revId}.json`));
    const reset = reconnectFeed(context.root, card(1).revId);
    assert.deepEqual(reset, { type: "reset", cards: [card(2)] });
    assert.deepEqual(readJournal(context.root).manifest.revs, [card(2).revId]);
    writeFileSync(join(context.root, `rev-${card(2).revId}.json`), JSON.stringify({ ...card(2), revId: card(3).revId }));
    const appended = appendCard(context.root, card(3), { identity });
    assert.deepEqual(appended.manifest.revs, [card(3).revId]);
  } finally {
    context.cleanup();
  }
});

test("bounded readers reject oversized manifests and prune oversized referenced cards", () => {
  const context = fixture();
  try {
    appendCard(context.root, card(1), { identity });
    writeFileSync(join(context.root, "manifest.json"), "x".repeat(70 * 1024));
    assert.throws(() => readJournal(context.root), /manifest exceeds/u);
    rmSync(join(context.root, "manifest.json"));
    appendCard(context.root, card(2), { identity });
    writeFileSync(join(context.root, `rev-${card(2).revId}.json`), "x".repeat(600 * 1024));
    const journal = readJournal(context.root);
    assert.equal(journal.race, true);
    assert.equal(journal.cards.some((entry) => entry.revId === card(2).revId), false);
  } finally {
    context.cleanup();
  }
});

test("reconnect uses manifest order, resets unknown ids, and never replays a stale race", () => {
  const context = fixture();
  try {
    appendCard(context.root, card(1), { identity });
    appendCard(context.root, card(2), { identity });
    const journal = readJournal(context.root);
    assert.deepEqual(resolveReconnect(journal.manifest, journal.cards, card(1).revId), { type: "replay", cards: [card(2)] });
    assert.deepEqual(resolveReconnect(journal.manifest, journal.cards, "r-ffffffffffffffffffffffff"), { type: "reset", cards: journal.cards });
    const manifest = { ...journal.manifest, updatedAt: "2000-01-01T00:00:00.000Z", revs: [card(2).revId, card(1).revId] };
    assert.deepEqual(resolveReconnect(manifest, [card(1), card(2)], null).cards.map((entry) => entry.revId), [card(2).revId, card(1).revId]);
    assert.equal(readFileSync(join(context.root, "manifest.json"), "utf8").includes(card(2).revId), true);
  } finally {
    context.cleanup();
  }
});
