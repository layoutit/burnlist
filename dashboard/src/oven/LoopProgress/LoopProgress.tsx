import type { ChecklistItem, ChecklistProgressData, LoopRunProjection } from "@lib";
import { effectiveItemWork } from "@lib/checklist-adapter";
import { LoopCompact } from "@/components/LoopGraph";
import "./LoopProgress.css";

function selectedItem(data: ChecklistProgressData) {
  return data.active.find((item) => item.id === data.selectedItemId) ?? data.active[0] ?? null;
}

function preview(item: ChecklistItem): LoopRunProjection | null {
  if (!item.loop) return null;
  return {
    schema: "burnlist-loop-read-projection@1",
    runId: "preview",
    itemRef: `item:preview#${item.id}`,
    loopId: item.loop.selector,
    loopRevision: null,
    createdAt: 0,
    updatedAt: 0,
    state: "prepared",
    currentNode: item.loop.graph?.entry ?? "start",
    attempt: 0,
    cycle: 0,
    revision: "preview",
    budget: {
      limits: { maxRounds: 0, maxMinutes: 0, maxAgentRuns: 0, maxCheckRuns: 0, maxTransitions: 0, maxOutputBytes: 0 },
      counters: { rounds: 0, agentRuns: 0, checkRuns: 0, transitions: 0, outputBytes: 0 },
      elapsedMilliseconds: 0,
      journal: { maximum: 0, used: 0, remaining: 0 },
    },
    latestResult: null,
    graph: item.loop.graph ?? { entry: "start", nodes: [], edges: [] },
    transitions: [],
  };
}

function loopLabel(item: ChecklistItem | null, run: LoopRunProjection | null = null) {
  const selector = run?.loopId ?? item?.loop?.selector;
  if (!selector) return "Direct work";
  if (selector.endsWith(":review")) return "Review Loop";
  if (selector.endsWith(":gate")) return "Gate Loop";
  if (selector.endsWith(":branch")) return "Branch Loop";
  return selector;
}

function displayNode(run: LoopRunProjection) {
  const node = run.graph.nodes.find((candidate) => candidate.id === run.currentNode);
  return node?.role ?? node?.capability ?? run.currentNode;
}

function activityText(record: NonNullable<LoopRunProjection["activity"]>["records"][number]) {
  const where = record.nodeId ? `${record.nodeId}${record.attempt ? ` #${record.attempt}` : ""}` : "Run";
  const detail = record.subagentId ? `subagent ${record.parentAgentId ? `${record.parentAgentId} / ` : ""}${record.subagentId}`
    : record.tool ?? record.capability ?? record.outcome ?? record.state ?? "";
  return [where, record.kind.replaceAll("-", " "), detail].filter(Boolean).join(" · ");
}

function duration(milliseconds: number | null | undefined) {
  if (milliseconds === null || milliseconds === undefined) return "Unavailable";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 100) / 10} s`;
  return `${Math.round(milliseconds / 6_000) / 10} min`;
}

function durationRange(range: { low: number; high: number }) {
  return `${duration(range.low)}–${duration(range.high)}`;
}

function tokenRange(range: { low: number; high: number }) {
  return `${range.low.toLocaleString("en-US")}–${range.high.toLocaleString("en-US")}`;
}

function observedTokens(run: LoopRunProjection | null, records: NonNullable<LoopRunProjection["activity"]>["records"]) {
  const telemetry = run?.execution?.telemetry;
  const observed = [...records].reverse().find((record) =>
    record.inputTokens !== null && record.inputTokens !== undefined
    || record.outputTokens !== null && record.outputTokens !== undefined);
  const input = telemetry?.inputTokens ?? observed?.inputTokens ?? null;
  const output = telemetry?.outputTokens ?? observed?.outputTokens ?? null;
  if (input === null && output === null) return null;
  return `${((input ?? 0) + (output ?? 0)).toLocaleString("en-US")} reported`;
}

function proofSignals(run: LoopRunProjection | null) {
  if (!run) return null;
  const labels = run.transitions.flatMap((transition) => {
    const node = run.graph.nodes.find((candidate) => candidate.id === transition.from);
    if (node?.kind === "check") return [`check ${transition.outcome}`];
    if (node?.kind === "gate") return [`gate ${transition.outcome}`];
    if (node?.kind === "agent" && /review/iu.test(node.role ?? node.id)) return [`review ${transition.outcome}`];
    return [];
  });
  const active = run.graph.nodes.find((candidate) => candidate.id === run.currentNode);
  if (active?.kind === "check") labels.push("check running");
  if (active?.kind === "gate") labels.push("gate running");
  if (active?.kind === "agent" && /review/iu.test(active.role ?? active.id)) labels.push("review waiting");
  return labels.slice(-3).join(" · ") || null;
}

function nowMessage(
  item: ChecklistItem | null,
  state: "PENDING" | "ACTIVE" | "WAITING" | "BLOCKED" | "COMPLETED",
  run: LoopRunProjection | null,
  progressing: boolean,
  reason: string,
) {
  if (!item || state === "COMPLETED") return "This item is recorded as complete in the Burnlist.";
  if (state === "PENDING") {
    return item.loop
      ? `No agent is working on this item yet. Its ${loopLabel(item)} is assigned and ready to start.`
      : "No agent is working on this item yet. It is waiting to be started as direct work.";
  }
  const step = run ? displayNode(run) : item.work?.run?.node ?? "next step";
  if (state === "ACTIVE") return progressing
    ? `Work is active at ${step}, with recent observed activity.`
    : `Work is active at ${step}. No recent activity is available.`;
  if (state === "WAITING") {
    if (run?.hostTask === "awaiting-claim") return `${step} is ready and waiting for an agent to claim it.`;
    if (run?.state === "converged") return "The Loop has converged and is waiting for the item to be burned.";
    return `${step} is waiting for the next action.`;
  }
  return `Work is blocked: ${run?.latestResult?.summary ?? reason}`;
}

export function LoopProgress({ data }: { data: ChecklistProgressData }) {
  const item = selectedItem(data);
  const authoritativeRun = data.loopRun ?? null;
  const selectedRun = item && authoritativeRun?.itemRef.endsWith(`#${item.id}`) ? authoritativeRun : null;
  const workState = item ? effectiveItemWork(data, item) : null;
  const state = workState?.state ?? "COMPLETED";
  const itemRun = selectedRun ?? (item ? preview(item) : null);
  const files = item?.fields["Files/search"] ?? "No declared file surface";
  const recentActivity = selectedRun?.activity?.records.slice(-10) ?? [];
  const observedPaths = [...new Set(recentActivity.flatMap((record) => [
    ...(record.observedPath ? [record.observedPath] : []),
    ...(record.observedPaths ?? []),
  ]))];
  const observation = [...recentActivity].reverse().find((record) =>
    record.provider || record.model || record.effort);
  const telemetry = selectedRun?.execution?.telemetry;
  const effort = observation?.effort ?? telemetry?.effort;
  const observedAgent = observation || telemetry
    ? [observation?.provider ?? telemetry?.provider, observation?.model ?? telemetry?.model,
      effort ? `effort ${effort}` : null].filter(Boolean).join(" · ")
    : null;
  const forecast = selectedRun?.forecast;
  const forecastProvenance = forecast
    ? forecast.provenance.kind === "local-observations"
      ? `${forecast.confidence} · ${forecast.provenance.matchingObservations} local observations`
      : `${forecast.confidence} · built-in prior`
    : null;
  const observedElapsed = selectedRun
    ? Math.max(
      selectedRun.budget.elapsedMilliseconds,
      ...recentActivity.map((record) => Math.max(0, record.at - selectedRun.createdAt)),
    )
    : null;
  const proof = proofSignals(selectedRun);
  const tokens = observedTokens(selectedRun, recentActivity);
  const currentStep = selectedRun ? displayNode(selectedRun) : workState?.run?.node ?? null;
  const latestActivity = recentActivity.at(-1) ?? null;
  const blocker = state === "BLOCKED"
    ? selectedRun?.latestResult?.summary ?? workState?.reason ?? "Human action is required."
    : null;
  const retries = selectedRun && (selectedRun.attempt > 1 || selectedRun.cycle > 0)
    ? `attempt ${selectedRun.attempt || 1} · repair cycle ${selectedRun.cycle || 0}`
    : null;
  const hasDetails = state !== "PENDING" && Boolean(item);

  return <section className={`loop-progress loop-progress--${state.toLowerCase()}`} aria-label="Loop progress">
    <header className="loop-progress__item">
      <div><span>ITEM</span><strong>{item ? `${item.id} · ${item.title}` : "No active item"}</strong></div>
      <b className="loop-progress__state">{state}</b>
      {workState?.progressing ? <em>recent activity</em> : null}
    </header>
    <p className="loop-progress__summary">
      {nowMessage(item, state, selectedRun, workState?.progressing ?? false, workState?.reason ?? "")}
    </p>

    <section className="loop-progress__loop" aria-label="Assigned Loop">
      <h2>ASSIGNED LOOP <small>{loopLabel(item, selectedRun)}</small></h2>
      {itemRun
        ? <LoopCompact run={itemRun} labels="hidden" title={`Assigned Loop for ${item?.id ?? "current item"}`} variant={selectedRun || item?.loop?.graph ? "topology" : "burn-cycle"} />
        : <p className="loop-progress__direct">This item uses direct work; no Loop is assigned.</p>}
    </section>

    {state !== "PENDING" && (currentStep || observedAgent || latestActivity || proof || blocker) ? <section className="loop-progress__current" aria-label="Current item facts">
      <h2>RIGHT NOW</h2>
      <dl>
        {currentStep ? <div><dt>Current step <small>canonical</small></dt><dd>{currentStep}</dd></div> : null}
        {blocker ? <div className="is-blocker"><dt>Needs attention <small>canonical</small></dt><dd>{blocker}</dd></div> : null}
        {proof ? <div><dt>Proof <small>canonical</small></dt><dd>{proof}</dd></div> : null}
        {observedAgent ? <div><dt>Agent <small>observed</small></dt><dd>{observedAgent}</dd></div> : null}
        {latestActivity ? <div><dt>Latest activity <small>observed</small></dt><dd>{activityText(latestActivity)}</dd></div> : null}
      </dl>
    </section> : null}

    {hasDetails ? <details className="loop-progress__details">
      <summary>More details</summary>
      <div className="loop-progress__details-body">
        {selectedRun ? <dl>
          <div><dt>Run <small>canonical</small></dt><dd>{selectedRun.runId} · {selectedRun.state} · claim {selectedRun.hostTask ?? "unavailable"}</dd></div>
          {retries ? <div><dt>Retries <small>canonical</small></dt><dd>{retries}</dd></div> : null}
          {observedElapsed && observedElapsed > 0 ? <div><dt>Elapsed <small>observed</small></dt><dd>{duration(observedElapsed)}</dd></div> : null}
          {tokens ? <div><dt>Tokens <small>reported</small></dt><dd>{tokens}</dd></div> : null}
          {forecast ? <div><dt>Estimate <small>forecast</small></dt><dd>{durationRange(forecast.wallTime)} · {tokenRange(forecast.totalTokens)} tokens · {forecastProvenance}</dd></div> : null}
          {observedPaths.length ? <div><dt>Changed paths <small>observed</small></dt><dd>{observedPaths.join(" · ")}</dd></div> : null}
        </dl> : null}
        {recentActivity.length ? <section className="loop-progress__activity" aria-label="Recent observed activity">
          <h3>Recent observed activity</h3>
          <ol>{recentActivity.slice().reverse().map((record, index) => <li key={`${record.at}/${record.kind}/${index}`}>
            <b>{record.origin}</b><span>{activityText(record)}</span>{record.truncated ? <small>truncated</small> : null}
          </li>)}</ol>
        </section> : null}
        <p className="loop-progress__files"><b>Declared files</b> {files}</p>
        <p className="loop-progress__provenance">Status, current step, proof, blocker, and retries come from the canonical Burnlist Run. Agent, activity, paths, elapsed time, and reported tokens are bounded observations. Estimates are forecasts.</p>
      </div>
    </details> : null}
  </section>;
}
