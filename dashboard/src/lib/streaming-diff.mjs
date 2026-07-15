const textFileKinds = new Set(["modified", "added", "deleted"]);

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
  return {
    path,
    kind,
    ...(typeof value.diff === "string" ? { diff: value.diff } : {}),
    ...(meta ? { meta } : {}),
  };
}

export function streamingDiffFeedHref({ logicalRepoKey, worktreeKey, session }) {
  const params = new URLSearchParams({ repoKey: logicalRepoKey, worktreeKey, session });
  return `/ovens/streaming-diff/view?${params}`;
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
    .map((feed) => ({ ...feed, repoLabel: repository.label })))
    .sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0));
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
  return {
    revId,
    toolUseId,
    ts,
    status,
    ...(status === "partial" && string(value.partialReason) ? { partialReason: value.partialReason } : {}),
    files,
  };
}

// Revisions are emitted in the manifest's ordered sequence. A pre-hook attempt
// is superseded by its terminal card using the common tool use id; a reconnect
// replay can still replace a card by its revision id without moving it.
export function groupStreamingDiffCard(cards, card) {
  const index = cards.findIndex((entry) => entry.toolUseId === card.toolUseId || entry.revId === card.revId);
  if (index < 0) return [...cards, card];
  const next = [...cards];
  next[index] = card;
  return next;
}

export function applyStreamingDiffUpdate(cards, update) {
  return update?.type === "reset" ? [] : update?.type === "card" && update.card
    ? groupStreamingDiffCard(cards, update.card)
    : cards;
}

export function fileKindChip(kind) {
  return metadataKindLabels[kind] ?? null;
}

export function isTextFileKind(kind) {
  return textFileKinds.has(kind);
}
