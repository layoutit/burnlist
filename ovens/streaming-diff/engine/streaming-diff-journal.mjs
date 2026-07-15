import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";

import { withLock } from "../../../src/server/fs-safe.mjs";
import { readContainedFile } from "./streaming-diff-capture-git.mjs";
import { STREAMING_DIFF_ABSENT } from "./streaming-diff-capture.mjs";
import { assertCard, assertManifest, STREAMING_DIFF_CONTRACT_LIMITS, STREAMING_DIFF_DATA_CONTRACT } from "./streaming-diff-data-contract.mjs";

export const STREAMING_DIFF_RETENTION = Object.freeze({ maxRevs: 128, maxBytes: 4 * 1024 * 1024 });
export const STREAMING_DIFF_JOURNAL_LIMITS = Object.freeze({ maxManifestBytes: 64 * 1024, maxCardBytes: STREAMING_DIFF_CONTRACT_LIMITS.maxCardBytes });

function cardPath(feedDir, revId) {
  return join(feedDir, `rev-${revId}.json`);
}

function manifestPath(feedDir) {
  return join(feedDir, "manifest.json");
}

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// A published name is not enough: the card and its parent directory must both
// be durable before a durable manifest may reference it.
function writeDurableAtomic(path, contents) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function cardBytes(card) {
  return Buffer.byteLength(JSON.stringify(card), "utf8");
}

function limitedCard(card) {
  return { revId: card.revId, toolUseId: card.toolUseId, ts: card.ts, status: "partial", partialReason: "card exceeds journal retention byte limit", files: [] };
}

function retention(value) {
  const result = { ...STREAMING_DIFF_RETENTION, ...value };
  if (!Number.isSafeInteger(result.maxRevs) || result.maxRevs < 1 || result.maxRevs > STREAMING_DIFF_CONTRACT_LIMITS.maxRevs) throw new Error(`journal maxRevs must be between 1 and ${STREAMING_DIFF_CONTRACT_LIMITS.maxRevs}`);
  if (!Number.isSafeInteger(result.maxBytes) || result.maxBytes < 1_024) throw new Error("journal maxBytes must be at least 1024 bytes");
  return result;
}

function readBoundedJson(path, maxBytes, label) {
  const root = realpathSync(dirname(path));
  const contents = readContainedFile(root, path, maxBytes);
  if (contents === STREAMING_DIFF_ABSENT) {
    const error = new Error(`${label} is unavailable`);
    error.code = "ENOENT";
    throw error;
  }
  if (!Buffer.isBuffer(contents)) throw new Error(`${label} is unavailable or exceeds its ${maxBytes}-byte limit`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contents));
}

function loadManifest(feedDir) {
  const path = manifestPath(feedDir);
  try {
    return assertManifest(readBoundedJson(path, STREAMING_DIFF_JOURNAL_LIMITS.maxManifestBytes, "manifest"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

// Dashboard readers use this manifest-only entrypoint. It must remain pure:
// no lock acquisition, recovery, pruning, or write is permitted on this path.
export function readManifestPure(feedDir) {
  return loadManifest(feedDir);
}

function loadCard(feedDir, revId) {
  return assertCard(readBoundedJson(cardPath(feedDir, revId), STREAMING_DIFF_JOURNAL_LIMITS.maxCardBytes, "card"));
}

function cardsForManifest(feedDir, manifest) {
  const cards = [];
  let invalid = false;
  for (const revId of manifest.revs) {
    try {
      const card = loadCard(feedDir, revId);
      if (card.revId !== revId) {
        invalid = true;
        continue;
      }
      cards.push(card);
    } catch {
      invalid = true;
    }
  }
  return { cards, invalid };
}

function healManifestUnsafe(feedDir) {
  const manifest = loadManifest(feedDir);
  if (!manifest) return { manifest: null, cards: [], changed: false };
  const valid = [];
  const cards = [];
  for (const revId of manifest.revs) {
    try {
      const card = loadCard(feedDir, revId);
      if (card.revId !== revId) continue;
      valid.push(revId);
      cards.push(card);
    } catch {
      // A lost, malformed, oversized, or mismatched referenced card cannot be
      // replayed safely; drop it from the durable manifest.
    }
  }
  if (valid.length === manifest.revs.length) return { manifest, cards, changed: false };
  const healed = assertManifest({ ...manifest, revs: valid });
  writeDurableAtomic(manifestPath(feedDir), JSON.stringify(healed));
  pruneUnreferencedCards(feedDir, valid);
  return { manifest: healed, cards, changed: true };
}

function retained(feedDir, revs, limits) {
  const selected = [];
  let bytes = 0;
  for (const revId of [...revs].reverse()) {
    const card = loadCard(feedDir, revId);
    const size = cardBytes(card);
    // Retention is a newest contiguous suffix: never skip a middle revision.
    if (selected.length >= limits.maxRevs || bytes + size > limits.maxBytes) break;
    selected.unshift(revId);
    bytes += size;
  }
  return selected;
}

function pruneUnreferencedCards(feedDir, revs) {
  const retainedRevs = new Set(revs);
  let removed = false;
  for (const entry of readdirSync(feedDir, { withFileTypes: true })) {
    if (!entry.name.startsWith("rev-") || !entry.name.endsWith(".json") || !entry.isFile()) continue;
    if (!retainedRevs.has(entry.name.slice(4, -5))) {
      rmSync(join(feedDir, entry.name), { force: true });
      removed = true;
    }
  }
  if (removed) fsyncDirectory(feedDir);
}

function sameIdentity(left, right) {
  return left?.logicalRepoKey === right?.logicalRepoKey
    && left?.worktreeKey === right?.worktreeKey
    && left?.session === right?.session;
}

export function appendCard(feedDir, card, { identity, now = () => new Date().toISOString(), limits, beforeManifestSwap, dedupeToolUseId = false } = {}) {
  assertCard(card);
  const bounded = retention(limits);
  mkdirSync(feedDir, { recursive: true });
  return withLock(feedDir, () => {
    const healed = healManifestUnsafe(feedDir);
    const previous = healed.manifest;
    if (!previous && !identity) throw new Error("new streaming feed requires an identity");
    if (previous && identity && !sameIdentity(previous.identity, identity)) throw new Error("streaming diff feed identity does not match its immutable manifest identity");
    if (dedupeToolUseId) {
      const existing = healed.cards.find((entry) => entry.toolUseId === card.toolUseId);
      if (existing) return { card: existing, manifest: previous, existing: true };
    }
    let published = card;
    if (cardBytes(published) > bounded.maxBytes) published = limitedCard(card);
    assertCard(published);
    const revision = cardPath(feedDir, published.revId);
    if (existsSync(revision)) throw new Error(`streaming diff revision already exists: ${published.revId}`);
    writeDurableAtomic(revision, JSON.stringify(published));
    const revs = retained(feedDir, [...(previous?.revs ?? []), published.revId], bounded);
    const manifest = assertManifest({ contract: STREAMING_DIFF_DATA_CONTRACT, identity: previous?.identity ?? identity, generation: previous?.generation ?? `g-${randomBytes(12).toString("hex")}`, updatedAt: now(), revs });
    beforeManifestSwap?.({ feedDir, card: published, manifest });
    writeDurableAtomic(manifestPath(feedDir), JSON.stringify(manifest));
    pruneUnreferencedCards(feedDir, manifest.revs);
    return { card: published, manifest };
  });
}

// This is the dashboard-safe reader. A referenced-card fault is reported as a
// race/reset with the readable cards, but is never repaired by an observer.
export function readJournal(feedDir) {
  const manifest = loadManifest(feedDir);
  if (!manifest) return { manifest: null, cards: [], race: false };
  const initial = cardsForManifest(feedDir, manifest);
  return { manifest, cards: initial.cards, race: initial.invalid };
}

export function resolveReconnect(manifest, availableRevs, since = null) {
  assertManifest(manifest);
  const cards = availableRevs instanceof Map ? availableRevs : new Map(Array.isArray(availableRevs) ? availableRevs.map((card) => [card.revId, card]) : []);
  const retained = [];
  for (const revId of manifest.revs) {
    const card = cards.get(revId);
    if (!card || card.revId !== revId) return { type: "reset", reread: true, cards: [] };
    retained.push(card);
  }
  const index = typeof since === "string" ? manifest.revs.indexOf(since) : -1;
  return index < 0 ? { type: "reset", cards: retained } : { type: "replay", cards: retained.slice(index + 1) };
}

export function reconnectFeed(feedDir, since = null) {
  let journal = readJournal(feedDir);
  if (!journal.manifest) return { type: "reset", cards: [] };
  if (journal.race) {
    // Recovery belongs exclusively to the CLI append/reconnect writer path.
    const healed = withLock(feedDir, () => healManifestUnsafe(feedDir));
    return { type: "reset", cards: healed.cards };
  }
  return resolveReconnect(journal.manifest, journal.cards, since);
}

export function reconnectFeedPure(feedDir, since = null) {
  const journal = readJournal(feedDir);
  if (!journal.manifest || journal.race) return { type: "reset", cards: journal.cards };
  return resolveReconnect(journal.manifest, journal.cards, since);
}

export function journalRevisionBytes(feedDir, revId) {
  return statSync(cardPath(feedDir, revId)).size;
}
