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
  const retained = retainedKey === null ? -1 : feeds.findIndex((feed) => agentMonitorFeedKey(feed) === retainedKey);
  const selected = retained >= 0 ? retained : -1;
  return Object.freeze({ feeds: Object.freeze([...feeds]), selected });
}

export function moveAgentMonitorFeed(
  navigation: AgentMonitorNavigation,
  direction: -1 | 1,
): AgentMonitorNavigation {
  if (!navigation.feeds.length) return navigation;
  const count = navigation.feeds.length + 1;
  const position = navigation.selected + 1;
  const selected = (position + direction + count) % count - 1;
  return Object.freeze({ ...navigation, selected });
}

export function agentMonitorFeedQuery(navigation: AgentMonitorNavigation): Readonly<Record<string, string | number>> {
  const feed = navigation.feeds[navigation.selected];
  return feed ? {
    worktreeKey: feed.identity.worktreeKey,
    session: feed.identity.session,
  } : { aggregate: 1 };
}

export function agentMonitorFeedLabel(navigation: AgentMonitorNavigation): string {
  const feed = navigation.feeds[navigation.selected];
  if (!feed) return `All sessions · ${navigation.feeds.length} observed`;
  const provider = feed.identity.session.split(":", 1)[0] || "session";
  const session = feed.identity.session.length > 12 ? `…${feed.identity.session.slice(-8)}` : feed.identity.session;
  return `${navigation.selected + 1}/${navigation.feeds.length} · ${provider} · ${session}`;
}
