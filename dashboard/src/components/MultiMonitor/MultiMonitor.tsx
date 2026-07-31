import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import {
  useAgentMonitorActivation,
  useAgentMonitorFeeds,
  useAgentMonitorSnapshot,
  type ResolvedOvenIr,
} from "@hooks";
import {
  agentMonitorFeedHref,
  agentMonitorSnapshotNotice,
  parseMultiMonitorSelections,
  shortThreadSession,
  multiMonitorAvailableFeeds,
  multiMonitorConversationPayload,
  multiMonitorDefaultSelections,
  multiMonitorFeedKey,
  multiMonitorHasExplicitEmpty,
  multiMonitorHref,
  multiMonitorThreadTitle,
} from "@lib";
import type { AgentMonitorFeed, AgentMonitorIdentity, AgentMonitorPayload } from "@lib";
import { Button, Select } from "@layout";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { MultiMonitorComposer } from "./MultiMonitorComposer";
import "./codex-thread.css";
import "./multi-monitor.css";

type ThreadColumnProps = {
  canSend: boolean;
  canSteerExternal: boolean;
  feed?: AgentMonitorFeed;
  identity: AgentMonitorIdentity;
  ir: ResolvedOvenIr;
  onRemove: () => void;
  writeToken: string;
};

function threadMetadata(payload: AgentMonitorPayload | null) {
  const monitor = payload?.monitor;
  return monitor && typeof monitor === "object" && monitor.thread
    && typeof monitor.thread === "object"
    ? monitor.thread
    : null;
}

function currentState(
  payload: AgentMonitorPayload | null,
  feed: AgentMonitorFeed | undefined,
  stale: boolean,
) {
  if (stale) return "Refreshing";
  const monitor = payload?.monitor;
  const thread = threadMetadata(payload);
  const turnOpen = thread && typeof thread === "object" && typeof thread.turnOpen === "boolean"
    ? thread.turnOpen
    : feed?.turnOpen;
  const summary = monitor && typeof monitor === "object" ? monitor.summary : null;
  const state = summary && typeof summary === "object" ? summary.state : null;
  const activity = state === "Live" || state === "Idle" ? state : feed?.state ?? "Idle";
  if (turnOpen === true) return activity === "Live" ? "Working" : "Stale";
  if (turnOpen === false) return "Ready";
  return activity;
}

function threadTitleKey(identity: AgentMonitorIdentity) {
  return `burnlist:multi-monitor:title:${identity.worktreeKey}:${identity.session}`;
}

function readThreadTitle(identity: AgentMonitorIdentity) {
  try {
    return window.localStorage.getItem(threadTitleKey(identity)) ?? "";
  } catch {
    return "";
  }
}

function storeThreadTitle(identity: AgentMonitorIdentity, title: string) {
  try {
    window.localStorage.setItem(threadTitleKey(identity), title);
  } catch {
    // Stable titles are an enhancement; storage denial must not break the column.
  }
}

export function MultiMonitorThreadHeader({
  identity,
  onRemove,
  state,
  title,
}: {
  identity: AgentMonitorIdentity;
  onRemove: () => void;
  state: string;
  title: string;
}) {
  const session = shortThreadSession(identity.session);
  return <header className="multi-monitor-thread-header">
    <div className="multi-monitor-thread-identity">
      <span aria-hidden="true" className="multi-monitor-status-dot" />
      <div className="multi-monitor-thread-copy">
        <h2 title={title}>{title}</h2>
        <p><span>{state}</span><span>Thread {session}</span></p>
      </div>
    </div>
    <div aria-label={`Actions for ${title}`} className="multi-monitor-thread-actions" role="group">
      <a
        aria-label={`Open thread ${identity.session} in Agent Monitor`}
        className="multi-monitor-column-action"
        href={agentMonitorFeedHref(identity)}
        title="Open in Agent Monitor"
      >
        <ExternalLink aria-hidden="true" />
      </a>
      <button
        aria-label={`Remove thread ${identity.session}`}
        className="multi-monitor-column-action"
        onClick={onRemove}
        title="Remove column"
        type="button"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  </header>;
}

function ThreadColumn({
  canSend,
  canSteerExternal,
  feed,
  identity,
  ir,
  onRemove,
  writeToken,
}: ThreadColumnProps) {
  const selection = {
    repoKey: identity.logicalRepoKey,
    worktreeKey: identity.worktreeKey,
    session: identity.session,
  };
  const snapshot = useAgentMonitorSnapshot(selection);
  const payload = snapshot.data ?? null;
  const conversation = useMemo(
    () => multiMonitorConversationPayload(payload),
    [payload],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const notice = agentMonitorSnapshotNotice(snapshot);
  const state = currentState(payload, feed, snapshot.stale);
  const fallbackTitle = `Thread ${shortThreadSession(identity.session)}`;
  const derivedTitle = multiMonitorThreadTitle(payload);
  const [title, setTitle] = useState(() => readThreadTitle(identity) || fallbackTitle);
  const metadata = threadMetadata(payload);
  const canCompose = (metadata?.provider === "codex"
    && metadata?.threadSource === "user"
    && metadata?.topLevel === true)
    || (feed?.provider === "codex" && feed.threadSource === "user" && feed.topLevel === true);
  const turnOpen = typeof metadata?.turnOpen === "boolean"
    ? metadata.turnOpen
    : feed?.turnOpen === true;
  const monitor = payload?.monitor;
  const truncated = monitor && typeof monitor === "object" && monitor.truncated === true;

  useEffect(() => {
    if (!derivedTitle) return;
    setTitle((current) => {
      if (current !== fallbackTitle) return current;
      storeThreadTitle(identity, derivedTitle);
      return derivedTitle;
    });
  }, [derivedTitle, fallbackTitle, identity]);

  useEffect(() => {
    if (!conversation || !followTail.current) return;
    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (body) body.scrollTop = body.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversation]);

  return <article
    aria-label={`${title}, thread ${shortThreadSession(identity.session)}`}
    className="multi-monitor-column"
    data-state={state.toLowerCase()}
  >
    <MultiMonitorThreadHeader identity={identity} onRemove={onRemove} state={state} title={title} />
    <div
      className="multi-monitor-column-body"
      onScroll={(event) => {
        const body = event.currentTarget;
        followTail.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
      }}
      ref={bodyRef}
    >
      {notice && <p className={`multi-monitor-notice${notice.kind === "error" ? " is-error" : ""}`}>{notice.text}</p>}
      {truncated && <p className="multi-monitor-retention">Earlier task activity is not shown.</p>}
      {conversation && <OvenRuntime ir={ir} payload={conversation} />}
    </div>
    <div className="multi-monitor-composer-slot">
      {canCompose ? <MultiMonitorComposer
        canSend={canSend}
        canSteerExternal={canSteerExternal}
        identity={identity}
        turnOpen={turnOpen}
        writeToken={writeToken}
      />
        : <div aria-hidden="true" className="codex-composer-placeholder" />}
    </div>
  </article>;
}

export function MultiMonitor({ ir, repoKey }: { ir: ResolvedOvenIr; repoKey: string | null }) {
  const initial = useMemo(
    () => repoKey ? parseMultiMonitorSelections({ repoKey, search: window.location.search }) as AgentMonitorIdentity[] : [],
    [repoKey],
  );
  const initialExplicitEmpty = useMemo(
    () => multiMonitorHasExplicitEmpty(window.location.search),
    [],
  );
  const [selections, setSelections] = useState<AgentMonitorIdentity[]>(initial);
  const [explicitEmpty, setExplicitEmpty] = useState(initialExplicitEmpty);
  const defaulted = useRef(initial.length > 0 || initialExplicitEmpty);
  const repositories = useMemo(
    () => repoKey ? [{ repoKey, label: repoKey }] : [],
    [repoKey],
  );
  const activation = useAgentMonitorActivation(repositories);
  const feeds = useAgentMonitorFeeds(repositories, activation.loading, false);
  const available = multiMonitorAvailableFeeds(feeds.feeds, selections) as AgentMonitorFeed[];
  const [candidate, setCandidate] = useState("");
  const feedsByKey = useMemo(
    () => new Map(feeds.feeds.map((feed) => [multiMonitorFeedKey(feed.identity), feed])),
    [feeds.feeds],
  );

  const updateSelections = (next: AgentMonitorIdentity[], replace = false) => {
    if (!repoKey) return;
    const nextExplicitEmpty = next.length === 0;
    const href = multiMonitorHref({
      repoKey,
      selections: next,
      explicitEmpty: nextExplicitEmpty,
    });
    window.history[replace ? "replaceState" : "pushState"](null, "", href);
    defaulted.current = true;
    setExplicitEmpty(nextExplicitEmpty);
    setSelections(next);
  };

  useEffect(() => {
    if (defaulted.current || feeds.loading || feeds.error) return;
    const defaults = multiMonitorDefaultSelections(feeds.feeds) as AgentMonitorIdentity[];
    if (!defaults.length) return;
    updateSelections(defaults, true);
  }, [explicitEmpty, feeds.error, feeds.feeds, feeds.loading, selections.length]);

  useEffect(() => {
    const selected = available.some((feed) => multiMonitorFeedKey(feed.identity) === candidate);
    if (!selected) setCandidate(available[0] ? multiMonitorFeedKey(available[0].identity) : "");
  }, [available, candidate]);

  useEffect(() => {
    const sync = () => {
      const next = repoKey
        ? parseMultiMonitorSelections({ repoKey, search: window.location.search }) as AgentMonitorIdentity[]
        : [];
      const nextExplicitEmpty = multiMonitorHasExplicitEmpty(window.location.search);
      defaulted.current = next.length > 0 || nextExplicitEmpty;
      setExplicitEmpty(nextExplicitEmpty);
      setSelections(next);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [repoKey]);

  if (!repoKey) {
    return <section className="multi-monitor-empty"><h1>Multi Monitor</h1><p>Open this Oven from a repository.</p></section>;
  }

  const addCandidate = () => {
    const feed = feedsByKey.get(candidate);
    if (feed) updateSelections([...selections, feed.identity]);
  };

  return <section className="multi-monitor-shell">
    <header className="multi-monitor-toolbar">
      <div className="multi-monitor-workspace-title">
        <h1>Multi Monitor</h1>
        <span className="multi-monitor-count">{selections.length} {selections.length === 1 ? "thread" : "threads"}</span>
      </div>
      <div aria-label="Multi Monitor actions" className="multi-monitor-add" role="group">
        <Select
          aria-label="Thread to add"
          disabled={!available.length}
          onChange={(event) => setCandidate(event.target.value)}
          value={candidate}
        >
          {!available.length && <option value="">No other Codex tasks</option>}
          {available.map((feed) => <option key={multiMonitorFeedKey(feed.identity)} value={multiMonitorFeedKey(feed.identity)}>
            {feed.title ?? `Thread ${shortThreadSession(feed.identity.session)}`} · {shortThreadSession(feed.identity.session)}
          </option>)}
        </Select>
        <Button disabled={!candidate} onClick={addCandidate} size="sm" variant="outline">
          <Plus aria-hidden="true" /> Add thread
        </Button>
      </div>
    </header>
    {activation.error && <p className="multi-monitor-service-error">{activation.error}</p>}
    {feeds.error && <p className="multi-monitor-service-error">{feeds.error}</p>}
    {selections.length ? <div aria-label="Monitored Codex tasks" className="multi-monitor-track">
      {selections.map((identity) => {
        const key = multiMonitorFeedKey(identity);
        return <ThreadColumn
          canSend={activation.canSend}
          canSteerExternal={activation.canSteerExternal}
          feed={feedsByKey.get(key)}
          identity={identity}
          ir={ir}
          key={key}
          onRemove={() => updateSelections(selections.filter((item) => multiMonitorFeedKey(item) !== key))}
          writeToken={activation.writeToken}
        />;
      })}
    </div> : <div className="multi-monitor-empty">
      <h1>{explicitEmpty ? "No task columns" : "No active Codex tasks"}</h1>
      <p>{explicitEmpty
        ? "Choose a top-level Codex task above and add it to the workspace."
        : "Open a top-level Codex task and it will appear here automatically."}</p>
    </div>}
  </section>;
}
