export type AgentMonitorFeed = Readonly<{
  identity: Readonly<{
    logicalRepoKey: string;
    worktreeKey: string;
    session: string;
  }>;
  updatedAt: string | null;
  href: string;
  title: string;
  detail: string;
  state: string | null;
}>;

export type AgentMonitorNavigation = Readonly<{
  feeds: readonly AgentMonitorFeed[];
  selected: number;
}>;

export const agentMonitorFeedKey = (feed: AgentMonitorFeed) =>
  JSON.stringify([feed.identity.logicalRepoKey, feed.identity.worktreeKey, feed.identity.session]);

export function selectAgentMonitorFeed(
  feeds: readonly AgentMonitorFeed[],
  retainedKey: string | null,
): AgentMonitorNavigation {
  const selected = retainedKey === null ? 0 : Math.max(0, feeds.findIndex((feed) => agentMonitorFeedKey(feed) === retainedKey));
  return Object.freeze({ feeds: Object.freeze([...feeds]), selected });
}

export function moveAgentMonitorFeed(
  navigation: AgentMonitorNavigation,
  direction: -1 | 1,
): AgentMonitorNavigation {
  if (navigation.feeds.length < 2) return navigation;
  const selected = (navigation.selected + direction + navigation.feeds.length) % navigation.feeds.length;
  return Object.freeze({ ...navigation, selected });
}

export function agentMonitorFeedQuery(navigation: AgentMonitorNavigation) {
  const feed = navigation.feeds[navigation.selected];
  return feed ? {
    worktreeKey: feed.identity.worktreeKey,
    session: feed.identity.session,
  } : null;
}

export function agentMonitorFeedLabel(navigation: AgentMonitorNavigation): string {
  const feed = navigation.feeds[navigation.selected];
  if (!feed) return "No observed sessions";
  const provider = feed.identity.session.split(":", 1)[0] || "session";
  const session = feed.identity.session.length > 12 ? `…${feed.identity.session.slice(-8)}` : feed.identity.session;
  return `${navigation.selected + 1}/${navigation.feeds.length} · ${provider} · ${session}`;
}
