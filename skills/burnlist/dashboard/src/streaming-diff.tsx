import { useEffect, useState } from "react";
import { FileDiff, FileMinus2, FilePlus2, History } from "lucide-react";
import "../streaming-diff.css";
// @ts-expect-error Shared plain ESM keeps the browser projection aligned with contract tests.
import { compactStreamingDiffLines } from "../../scripts/streaming-diff-contract.mjs";

type DiffLine = {
  kind: "context" | "addition" | "deletion" | "omission";
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
};

type DiffChange = {
  id: string;
  revision: number;
  timestamp: string;
  sourcePath: string;
  actor: { threadId: string; turnId: string; toolName: string };
  summary: { additions: number; deletions: number; changedLines: number };
  lines: DiffLine[];
};

type StreamingDiffData = {
  schema: "burnlist-streaming-diff-data@2";
  status: "streaming";
  generatedAt: string;
  revision: number;
  source: { path: "."; kind: "thread" };
  thread: { id: string; turnId: string | null; label: string; lastActiveAt: string };
  changes: DiffChange[];
};

type ThreadFeed = {
  id: string;
  label: string;
  lastActiveAt: string;
  revision: number;
  changeCount: number;
  lastFile: string | null;
};

type DiffView = "unified" | "split";
type SplitRow = { before: DiffLine | null; after: DiffLine | null; omission?: boolean };
export type StreamingDiffConnection = "disconnected" | "connecting" | "connected" | "error";

function viewerSessionId() {
  const key = "burnlist-streaming-diff-viewer";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function timestampTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(date);
}

function fileType(sourcePath: string) {
  const name = sourcePath.split("/").at(-1) ?? sourcePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
}

function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind === "omission") {
      rows.push({ before: null, after: null, omission: true });
      index += 1;
      continue;
    }
    if (line.kind === "context") {
      rows.push({ before: line, after: line });
      index += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && ["deletion", "addition"].includes(lines[index].kind)) {
      if (lines[index].kind === "deletion") deletions.push(lines[index]);
      else additions.push(lines[index]);
      index += 1;
    }
    for (let pair = 0; pair < Math.max(deletions.length, additions.length); pair += 1) {
      rows.push({ before: deletions[pair] ?? null, after: additions[pair] ?? null });
    }
  }
  return rows;
}

function UnifiedDiff({ change, lines }: { change: DiffChange; lines: DiffLine[] }) {
  return (
    <div className="streaming-diff-code streaming-diff-unified" role="table" aria-label={`Unified diff captured ${timestamp(change.timestamp)}`}>
      {lines.map((line, index) => (
        <div className="streaming-diff-line" data-kind={line.kind} key={`${change.id}-${index}`} role="row">
          {line.kind === "omission" ? (
            <span className="streaming-diff-omission" role="cell">… unchanged lines omitted …</span>
          ) : (
            <>
              <span className="streaming-diff-line-number" role="cell">{line.oldNumber ?? ""}</span>
              <span className="streaming-diff-line-number" role="cell">{line.newNumber ?? ""}</span>
              <span aria-hidden="true" className="streaming-diff-line-marker">{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}</span>
              <code role="cell">{line.text || " "}</code>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function SplitCell({ line, side }: { line: DiffLine | null; side: "before" | "after" }) {
  const number = side === "before" ? line?.oldNumber : line?.newNumber;
  return (
    <div className="streaming-diff-split-cell" data-kind={line?.kind ?? "empty"} role="cell">
      <span className="streaming-diff-line-number">{number ?? ""}</span>
      <span aria-hidden="true" className="streaming-diff-line-marker">{line?.kind === "addition" ? "+" : line?.kind === "deletion" ? "−" : " "}</span>
      <code>{line?.text || " "}</code>
    </div>
  );
}

function SplitDiff({ change, lines }: { change: DiffChange; lines: DiffLine[] }) {
  return (
    <div className="streaming-diff-code streaming-diff-split" role="table" aria-label={`Split diff captured ${timestamp(change.timestamp)}`}>
      <div className="streaming-diff-split-head" role="row">
        <span role="columnheader">Before</span>
        <span role="columnheader">After</span>
      </div>
      {splitRows(lines).map((row, index) => row.omission ? (
        <div className="streaming-diff-split-omission" key={`${change.id}-split-${index}`} role="row">… unchanged lines omitted …</div>
      ) : (
        <div className="streaming-diff-split-row" key={`${change.id}-split-${index}`} role="row">
          <SplitCell line={row.before} side="before" />
          <SplitCell line={row.after} side="after" />
        </div>
      ))}
    </div>
  );
}

function ChangeCard({ change, latest, view }: { change: DiffChange; latest: boolean; view: DiffView }) {
  const visibleLines = compactStreamingDiffLines(change.lines, 2) as DiffLine[];
  const type = fileType(change.sourcePath);
  return (
    <article className="panel streaming-diff-card" data-latest={latest ? "true" : "false"} data-thread-id={change.actor.threadId}>
      <header className="streaming-diff-card-head">
        <div className="streaming-diff-card-identity">
          <span aria-hidden="true" className="streaming-diff-file-icon" data-file-type={type.toLowerCase()}>{type}</span>
          <h2>
            <time dateTime={change.timestamp}>{timestampTime(change.timestamp)}</time>
            <span aria-hidden="true" className="streaming-diff-card-title-separator">@</span>
            <span className="streaming-diff-card-path">{change.sourcePath}</span>
          </h2>
        </div>
        <div aria-label={`${change.summary.additions} additions and ${change.summary.deletions} deletions`} className="streaming-diff-card-summary">
          <span className="streaming-diff-additions">+{change.summary.additions}</span>
          <span className="streaming-diff-deletions">−{change.summary.deletions}</span>
          <span className="streaming-diff-revision">#{change.revision}</span>
        </div>
      </header>
      {view === "unified" ? <UnifiedDiff change={change} lines={visibleLines} /> : <SplitDiff change={change} lines={visibleLines} />}
    </article>
  );
}

export function StreamingDiffPage({ disconnectRequest = 0, onConnectionChange, onTimestampChange }: { disconnectRequest?: number; onConnectionChange?: (connection: StreamingDiffConnection) => void; onTimestampChange?: (timestamp: string | null) => void }) {
  const [viewerId] = useState(viewerSessionId);
  const [data, setData] = useState<StreamingDiffData | null>(null);
  const [connection, setConnection] = useState<StreamingDiffConnection>("disconnected");
  const [streamVersion, setStreamVersion] = useState(0);
  const [view, setView] = useState<DiffView>("unified");
  const [error, setError] = useState("");
  const [threads, setThreads] = useState<ThreadFeed[]>([]);

  useEffect(() => onConnectionChange?.(connection), [connection, onConnectionChange]);
  useEffect(() => onTimestampChange?.(data?.changes[0]?.timestamp ?? data?.generatedAt ?? null), [data, onTimestampChange]);

  useEffect(() => {
    document.body.classList.add("driving-parity-view", "streaming-diff-body");
    return () => document.body.classList.remove("driving-parity-view", "streaming-diff-body");
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/streaming-diff/events?viewer=${encodeURIComponent(viewerId)}`);
    source.addEventListener("detached", () => {
      source.close();
      setConnection("disconnected");
      setData(null);
      setError("");
    });
    source.addEventListener("snapshot", (event) => {
      const message = JSON.parse((event as MessageEvent).data);
      setData(message.payload);
      setConnection("connected");
      setError("");
    });
    source.addEventListener("stream-error", (event) => {
      const message = JSON.parse((event as MessageEvent).data);
      setConnection("error");
      setError(message.error ?? "The thread feed could not be read.");
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      setConnection("error");
      setError("Streaming Diff connection lost.");
    };
    return () => source.close();
  }, [streamVersion, viewerId]);

  const controllerToken = async () => {
    const response = await fetch("/api/ovens", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || typeof result.writeToken !== "string") throw new Error(result.error ?? "Could not read the local controller token.");
    return result.writeToken as string;
  };

  const attachThread = async (threadId: string, token?: string) => {
    setConnection("connecting");
    setError("");
    try {
      const writeToken = token ?? await controllerToken();
      const response = await fetch("/api/streaming-diff/attachments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnlist-token": writeToken },
        body: JSON.stringify({ viewerId, threadId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not attach this viewer.");
      setThreads([]);
      setStreamVersion((version) => version + 1);
    } catch (cause) {
      setConnection("error");
      setError(cause instanceof Error ? cause.message : "Could not attach this viewer.");
    }
  };

  const attachViewer = async () => {
    setConnection("connecting");
    setError("");
    setThreads([]);
    try {
      const writeToken = await controllerToken();
      const response = await fetch("/api/streaming-diff/threads", {
        cache: "no-store",
        headers: { "x-burnlist-token": writeToken },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not discover active task feeds.");
      const activeThreads = Array.isArray(result.threads) ? result.threads as ThreadFeed[] : [];
      if (activeThreads.length === 0) throw new Error("No active task feeds are available yet.");
      if (activeThreads.length === 1) {
        await attachThread(activeThreads[0].id, writeToken);
        return;
      }
      setThreads(activeThreads);
      setConnection("disconnected");
    } catch (cause) {
      setConnection("error");
      setError(cause instanceof Error ? cause.message : "Could not discover active task feeds.");
    }
  };

  const disconnectViewer = async () => {
    try {
      const writeToken = await controllerToken();
      const response = await fetch("/api/streaming-diff/attachments", {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-burnlist-token": writeToken },
        body: JSON.stringify({ viewerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not disconnect this viewer.");
      setData(null);
      setConnection("disconnected");
      setStreamVersion((version) => version + 1);
    } catch (cause) {
      setConnection("error");
      setError(cause instanceof Error ? cause.message : "Could not disconnect this viewer.");
    }
  };

  useEffect(() => { if (disconnectRequest > 0) void disconnectViewer(); }, [disconnectRequest]);

  const latest = data?.changes[0] ?? null;
  const additions = data?.changes.reduce((total, change) => total + change.summary.additions, 0) ?? 0;
  const deletions = data?.changes.reduce((total, change) => total + change.summary.deletions, 0) ?? 0;
  const attached = connection === "connected";

  return (
    <div className="shell detail-view-shell driving-parity-view changes-tab-shell streaming-diff-view">
      <span aria-label={`Burnlist viewer ${viewerId}`} className="streaming-diff-viewer-sr" data-burnlist-viewer-id={viewerId} role="status">Streaming Diff viewer ready</span>
      <main className="detail-view" id="burnlist-detail">
        <section className="differential-overview streaming-diff-overview">
          <div aria-label="Streaming Diff summary" className="driving-parity-kpi-strip has-burns streaming-diff-kpis">
            <div className="driving-parity-kpi-item driving-parity-kpi-title-item">
              <div className="driving-parity-kpi-title">Streaming Diff</div>
              <div className="driving-parity-kpi-title-subtitle" title={data?.thread.id}>
                {data ? `Agent · ${data.thread.id.slice(-8)}` : "No agent attached"}
              </div>
            </div>
            <div className="driving-parity-kpi-item driving-parity-kpi-section"><FileDiff aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" /><div className="driving-parity-kpi-text"><span className="streaming-diff-kpi-value">{data?.changes.length ?? 0}</span><span className="streaming-diff-kpi-label">Changes</span></div></div>
            <div className="driving-parity-kpi-item driving-parity-kpi-section"><FilePlus2 aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon streaming-diff-kpi-icon-additions" /><div className="driving-parity-kpi-text"><span className="streaming-diff-kpi-value additions">+{additions}</span><span className="streaming-diff-kpi-label">Added</span></div></div>
            <div className="driving-parity-kpi-item driving-parity-kpi-section"><FileMinus2 aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon streaming-diff-kpi-icon-deletions" /><div className="driving-parity-kpi-text"><span className="streaming-diff-kpi-value deletions">−{deletions}</span><span className="streaming-diff-kpi-label">Deleted</span></div></div>
            <div className="driving-parity-kpi-item driving-parity-kpi-section"><History aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" /><div className="driving-parity-kpi-text"><span className="streaming-diff-kpi-value">#{data?.revision ?? 0}</span><span className="streaming-diff-kpi-label">Revision</span></div></div>
          </div>
        </section>
        {!attached ? (
          <div className="streaming-diff-message">
            <div className="streaming-diff-waiting">
              <p>{error || (threads.length > 1 ? "Choose the task feed for this browser tab." : "This browser tab is not attached to a task feed.")}</p>
              {threads.length > 1 ? (
                <div className="streaming-diff-thread-picker" role="list" aria-label="Active task feeds">
                  {threads.map((thread) => (
                    <div key={thread.id} role="listitem">
                      <button disabled={connection === "connecting"} onClick={() => void attachThread(thread.id)} type="button">
                        <span>{thread.label}</span>
                        <small>{thread.lastFile ?? `${thread.changeCount} changes`} · {timestamp(thread.lastActiveAt)}</small>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <button className="streaming-diff-attach" disabled={connection === "connecting"} onClick={() => void attachViewer()} type="button">
                  {connection === "connecting" ? "Finding tasks…" : "Attach this task"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <section aria-label="Timestamped changes" className="streaming-diff-change-list">
            <div className="work-panel-head streaming-diff-feed-head">
              <div className="work-panel-title">Changes <span className="field-list-count">({data!.changes.length})</span></div>
              <div aria-label="Diff layout" className="differential-tabs streaming-diff-view-controls">
                <button aria-pressed={view === "unified"} onClick={() => setView("unified")} type="button">Unified</button>
                <span aria-hidden="true" className="sep">·</span>
                <button aria-pressed={view === "split"} onClick={() => setView("split")} type="button">Split</button>
              </div>
            </div>
            {latest ? <div className="streaming-diff-feed">{data!.changes.map((change, index) => <ChangeCard change={change} key={change.id} latest={index === 0} view={view} />)}</div> : <div className="streaming-diff-message">Watching this task’s repository tree. Ordinary edits will appear here.</div>}
          </section>
        )}
      </main>
    </div>
  );
}
