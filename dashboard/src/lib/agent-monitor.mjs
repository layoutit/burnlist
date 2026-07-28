function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value ? value : null;
}

function identity(value) {
  if (!object(value)) return null;
  const logicalRepoKey = text(value.logicalRepoKey);
  const worktreeKey = text(value.worktreeKey);
  const session = text(value.session);
  return logicalRepoKey && worktreeKey && session ? { logicalRepoKey, worktreeKey, session } : null;
}

function summary(value) {
  if (!object(value) || !["Live", "Idle"].includes(value.state) || !text(value.current)
      || !Number.isSafeInteger(value.lines) || value.lines < 0
      || !Number.isSafeInteger(value.failures) || value.failures < 0) return null;
  return {
    state: value.state,
    current: value.current,
    lines: value.lines,
    failures: value.failures,
  };
}

function shortSession(value) {
  return value.length > 12 ? `…${value.slice(-8)}` : value;
}

export function agentMonitorFeedHref({ logicalRepoKey, worktreeKey, session }) {
  const query = new URLSearchParams({ worktreeKey, session });
  return `/r/${encodeURIComponent(logicalRepoKey)}/o/agent-monitor?${query}`;
}

export function mapAgentMonitorFeeds(value) {
  if (!object(value) || !Array.isArray(value.feeds)) return [];
  return value.feeds.flatMap((feed) => {
    if (!object(feed)) return [];
    const feedIdentity = identity(feed.identity);
    if (!feedIdentity) return [];
    const feedSummary = summary(feed.summary);
    return [{
      identity: feedIdentity,
      updatedAt: text(feed.updatedAt),
      href: agentMonitorFeedHref(feedIdentity),
      title: feedSummary ? `${feedSummary.state} · ${feedSummary.current}` : `Thread ${shortSession(feedIdentity.session)}`,
      detail: feedSummary
        ? `Thread ${shortSession(feedIdentity.session)} · ${feedSummary.lines.toLocaleString()} events${feedSummary.failures ? ` · ${feedSummary.failures} failure${feedSummary.failures === 1 ? "" : "s"}` : ""}`
        : `Exact session ${feedIdentity.session}`,
      state: feedSummary?.state ?? null,
    }];
  }).sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0));
}

export function agentMonitorRepositories(projects) {
  const repositories = new Map();
  for (const project of projects) {
    if (typeof project?.repoKey === "string" && project.repoKey && !repositories.has(project.repoKey)) {
      repositories.set(project.repoKey, {
        repoKey: project.repoKey,
        label: project.displayName || project.repoKey,
      });
    }
  }
  return [...repositories.values()];
}

export function mapAgentMonitorLandingFeeds(results) {
  return results.flatMap(({ repository, payload }) => mapAgentMonitorFeeds(payload)
    .filter((feed) => feed.identity.logicalRepoKey === repository.repoKey)
    .map((feed) => ({ ...feed, repoLabel: repository.label })))
    .sort((left, right) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0));
}

export function agentMonitorAutoOpenHref(feeds) {
  return feeds.length === 1 ? feeds[0].href : null;
}

export function parseAgentMonitorSnapshot(value, expected) {
  if (!object(value) || !object(value.payload)) return null;
  const payloadIdentity = identity(value.payload.identity);
  if (!payloadIdentity || value.payload.contract !== "burnlist-agent-monitor-data@1") return null;
  if (expected && (payloadIdentity.logicalRepoKey !== expected.repoKey
    || payloadIdentity.worktreeKey !== expected.worktreeKey
    || payloadIdentity.session !== expected.session)) return null;
  return value.payload;
}

export function agentMonitorSnapshotNotice(snapshot) {
  if (typeof snapshot?.error === "string" && snapshot.error) {
    return { kind: "error", text: snapshot.error };
  }
  if (snapshot?.loading && snapshot.data == null) {
    return { kind: "loading", text: "Loading thread statistics." };
  }
  return null;
}
