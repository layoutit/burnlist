import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { withLock } from "../../../src/server/fs-safe.mjs";
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
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`${label} exceeds its ${maxBytes}-byte limit`);
  return JSON.parse(readFileSync(path, "utf8"));
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

function loadCard(feedDir, revId) {
  return assertCard(readBoundedJson(cardPath(feedDir, revId), STREAMING_DIFF_JOURNAL_LIMITS.maxCardBytes, "card"));
}

function cardsForManifest(feedDir, manifest) {
  const cards = [];
  for (const revId of manifest.revs) {
    try {
      const card = loadCard(feedDir, revId);
      if (card.revId !== revId) return { cards: [], invalid: true };
      cards.push(card);
    } catch {
      return { cards: [], invalid: true };
    }
  }
  return { cards, invalid: false };
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

export function appendCard(feedDir, card, { identity, now = () => new Date().toISOString(), limits, beforeManifestSwap } = {}) {
  assertCard(card);
  const bounded = retention(limits);
  mkdirSync(feedDir, { recursive: true });
  return withLock(feedDir, () => {
    const healed = healManifestUnsafe(feedDir);
    const previous = healed.manifest;
    if (!previous && !identity) throw new Error("new streaming feed requires an identity");
    let published = card;
    if (cardBytes(published) > bounded.maxBytes) published = limitedCard(card);
    assertCard(published);
    const revision = cardPath(feedDir, published.revId);
    if (existsSync(revision)) throw new Error(`streaming diff revision already exists: ${published.revId}`);
    writeDurableAtomic(revision, JSON.stringify(published));
    const revs = retained(feedDir, [...(previous?.revs ?? []), published.revId], bounded);
    const manifest = assertManifest({ contract: STREAMING_DIFF_DATA_CONTRACT, identity: previous?.identity ?? identity, updatedAt: now(), revs });
    beforeManifestSwap?.({ feedDir, card: published, manifest });
    writeDurableAtomic(manifestPath(feedDir), JSON.stringify(manifest));
    pruneUnreferencedCards(feedDir, manifest.revs);
    return { card: published, manifest };
  });
}

// Readers enumerate the manifest only, so temp files and card-first crash
// orphans are invisible. A referenced-card fault is repaired before reconnect.
export function readJournal(feedDir) {
  const manifest = loadManifest(feedDir);
  if (!manifest) return { manifest: null, cards: [], race: false };
  const initial = cardsForManifest(feedDir, manifest);
  if (!initial.invalid) return { manifest, cards: initial.cards, race: false };
  const healed = withLock(feedDir, () => healManifestUnsafe(feedDir));
  return { manifest: healed.manifest, cards: healed.cards, race: true };
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
    journal = readJournal(feedDir);
    return { type: "reset", cards: journal.cards };
  }
  return resolveReconnect(journal.manifest, journal.cards, since);
}

export function journalRevisionBytes(feedDir, revId) {
  return statSync(cardPath(feedDir, revId)).size;
}
