const textFileKinds = new Set(["modified", "added", "deleted"]);
const withheldFileKinds = new Set(["denied", "redacted", "truncated", "unavailable"]);

const metadataKindLabels = Object.freeze({
  binary: "binary",
  denied: "denied",
  redacted: "redacted",
  truncated: "truncated",
  unavailable: "unavailable",
});

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value) {
  return typeof value === "string" ? value : null;
}

function identity(value) {
  if (!object(value)) return null;
  const logicalRepoKey = string(value.logicalRepoKey);
  const worktreeKey = string(value.worktreeKey);
  const session = string(value.session);
  return logicalRepoKey && worktreeKey && session ? { logicalRepoKey, worktreeKey, session } : null;
}

function parseFile(value) {
  if (!object(value)) return null;
  const path = string(value.path);
  const kind = string(value.kind);
  if (!path || !kind) return null;
  const meta = object(value.meta) ? {
    ...(Number.isSafeInteger(value.meta.bytes) && value.meta.bytes >= 0 ? { bytes: value.meta.bytes } : {}),
    ...(string(value.meta.reason) ? { reason: value.meta.reason } : {}),
    ...(value.meta.redacted === true ? { redacted: true } : {}),
  } : undefined;
  const withheld = meta?.redacted === true || withheldFileKinds.has(kind);
  return {
    path,
    kind,
    ...(!withheld && typeof value.diff === "string" ? { diff: value.diff } : {}),
    ...(meta ? { meta } : {}),
  };
}

export function streamingDiffFeedHref({ logicalRepoKey, worktreeKey, session }) {
  const params = new URLSearchParams({ worktreeKey, session });
  return `/r/${encodeURIComponent(logicalRepoKey)}/o/streaming-diff?${params}`;
}

export function mapStreamingDiffFeeds(value) {
  if (!object(value) || !Array.isArray(value.feeds)) return [];
  return value.feeds.map((feed) => {
    if (!object(feed)) return null;
    const feedIdentity = identity(feed.identity);
    if (!feedIdentity) return null;
    const updatedAt = string(feed.updatedAt);
    return { identity: feedIdentity, updatedAt, href: streamingDiffFeedHref(feedIdentity) };
  }).filter(Boolean).sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0));
}

export function streamingDiffRepositories(projects) {
  const repositories = new Map();
  for (const project of projects) {
    if (typeof project?.repoKey === "string" && project.repoKey && !repositories.has(project.repoKey)) {
      repositories.set(project.repoKey, { repoKey: project.repoKey, label: project.displayName || project.repoKey });
    }
  }
  return [...repositories.values()];
}

export function mapStreamingDiffLandingFeeds(results) {
  return results.flatMap(({ repository, payload }) => mapStreamingDiffFeeds(payload)
    .filter((feed) => feed.identity.logicalRepoKey === repository.repoKey)
    .map((feed) => ({ ...feed, repoLabel: repository.label })))
    .sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0));
}

export function streamingDiffFeedKey(feed) {
  const { logicalRepoKey, worktreeKey, session } = feed.identity;
  return `${logicalRepoKey}/${worktreeKey}/${session}`;
}

export function streamingDiffAutoOpenHref(feeds) {
  return feeds.length === 1 ? feeds[0].href : null;
}

export function parseStreamingDiffCard(value) {
  if (!object(value) || !Array.isArray(value.files)) return null;
  const revId = string(value.revId);
  const toolUseId = string(value.toolUseId);
  const ts = string(value.ts);
  const status = value.status === "captured" || value.status === "partial" ? value.status : null;
  if (!revId || !toolUseId || !ts || !status) return null;
  const files = value.files.map(parseFile).filter(Boolean);
  if (files.length !== value.files.length) return null;
  const withheld = files.some((file) => file.meta?.redacted === true || withheldFileKinds.has(file.kind));
  const partialReason = string(value.partialReason);
  return {
    revId,
    toolUseId,
    ts,
    status: status === "partial" || withheld ? "partial" : "captured",
    ...(partialReason ? { partialReason } : withheld ? { partialReason: "One or more file diffs were withheld." } : {}),
    files,
  };
}

// Revisions are emitted in the manifest's ordered sequence. A pre-hook attempt
// is superseded by its terminal card using the common tool use id; a reconnect
// replay can still replace a card by its revision id without moving it.
export function groupStreamingDiffCard(cards, card) {
  const index = cards.findIndex((entry) => entry.toolUseId === card.toolUseId || entry.revId === card.revId);
  if (index < 0) return [...cards, card];
  const matches = (entry) => entry.toolUseId === card.toolUseId || entry.revId === card.revId;
  const existingTerminal = cards.find((entry) => entry.toolUseId === card.toolUseId && !isAttemptCard(entry));
  const replacement = isAttemptCard(card) && existingTerminal ? existingTerminal : card;
  const next = cards.filter((entry) => !matches(entry));
  return [...next.slice(0, index), replacement, ...next.slice(index)];
}

function isAttemptCard(card) {
  return card.status === "partial" && card.files.length === 0 && card.partialReason?.startsWith("attempt in progress") === true;
}

export function applyStreamingDiffUpdate(cards, update) {
  return update?.type === "reset" ? [] : update?.type === "card" && update.card
    ? groupStreamingDiffCard(cards, update.card)
    : cards;
}

export function fileKindChip(kind, meta) {
  return meta?.redacted === true ? "redacted" : metadataKindLabels[kind] ?? null;
}

export function isTextFileKind(kind) {
  return textFileKinds.has(kind);
}
