import { useEffect, useMemo } from "react";
import { useAgentMonitorFeeds, useAgentMonitorSnapshot, type ResolvedOvenIr } from "@hooks";
import { FeedList } from "@oven";
import {
  agentMonitorAutoOpenHref,
  agentMonitorRepositories,
  agentMonitorSelection,
  agentMonitorSnapshotNotice,
  ovenRepoKey,
} from "@lib";
import type { Project } from "@lib";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import "./agent-monitor.css";

export function AgentMonitor({
  ir,
  projects,
  projectsLoading,
}: {
  ir: ResolvedOvenIr;
  projects: Project[];
  projectsLoading: boolean;
}) {
  const selection = agentMonitorSelection();
  const repoKey = ovenRepoKey();
  const repositories = useMemo(
    () => repoKey ? [{ repoKey, label: repoKey }] : agentMonitorRepositories(projects),
    [projects, repoKey],
  );
  const feeds = useAgentMonitorFeeds(repositories, projectsLoading, Boolean(selection));
  const snapshot = useAgentMonitorSnapshot(selection);
  const notice = agentMonitorSnapshotNotice(snapshot);
  const autoOpenHref = agentMonitorAutoOpenHref(feeds.feeds);

  useEffect(() => {
    if (autoOpenHref) window.location.replace(autoOpenHref);
  }, [autoOpenHref]);

  if (!selection) {
    return <FeedList
      {...feeds}
      description="Recent Codex threads for this repository, identified by exact session id."
      emptyText="No recent Codex thread feeds."
      loadingText="Loading recent Codex threads."
      showRepository={!repoKey && repositories.length > 1}
      title="Agent Monitor"
    />;
  }

  const backHref = `/r/${encodeURIComponent(selection.repoKey)}/o/agent-monitor`;
  return <section className="agent-monitor-selected">
    <header className="agent-monitor-heading">
      <a className="agent-monitor-back" href={backHref}>Recent threads</a>
      <h1>Agent Monitor</h1>
      <p>Thread {selection.session}</p>
    </header>
    {notice && <p className={`agent-monitor-message${notice.kind === "error" ? " is-error" : ""}`}>{notice.text}</p>}
    {snapshot.data && <OvenRuntime ir={ir} payload={snapshot.data} />}
  </section>;
}
