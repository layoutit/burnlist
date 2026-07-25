import type { ChecklistItem, ChecklistProgressData, LoopRunProjection } from "@lib";
import { LoopCompact } from "@/components/LoopGraph";
import "./LoopProgress.css";

const architecture = [
  { id: "plan", label: "Plan", detail: "item contract", hint: ["notes/burnlists", "plan-model"], why: "Keeps the work clear and ordered." },
  { id: "loops", label: "Loop control", detail: "claim · route", hint: ["src/loops", ".burnlist/loops", "LoopGraph", "src/cli/loop"], why: "Keeps each step controlled and verifiable." },
  { id: "work", label: "Agent + workspace", detail: "make the change", hint: ["adapters", "workspace", "provider"], why: "Gives the work a bounded place to happen." },
  { id: "proof", label: "Validate + review", detail: "prove · decide", hint: ["validate", "review", "test", "capabilities"], why: "Checks the result before it can move forward." },
  { id: "burn", label: "Burn", detail: "complete item", hint: ["completion", "lifecycle"], why: "Finishes work only after its proof is complete." },
  { id: "observe", label: "Observer", detail: "Oven · events", hint: ["ovens/", "src/ovens", "src/server", "dashboard/src/oven", "src/events", "hooks", "streaming-diff"], why: "Makes truthful progress easy to see." },
] as const;

function selectedItem(data: ChecklistProgressData) {
  return data.active.find((item) => item.id === data.selectedItemId) ?? data.active[0] ?? null;
}

function subsystem(item: ChecklistItem | null) {
  const surface = `${item?.fields["Files/search"] ?? ""} ${item?.title ?? ""}`.toLowerCase();
  let best = architecture[0];
  let score = 0;
  for (const candidate of architecture) {
    const matches = candidate.hint.filter((hint) => surface.includes(hint.toLowerCase())).length;
    if (matches > score) {
      best = candidate;
      score = matches;
    }
  }
  return best;
}

function plainWhy(item: ChecklistItem | null, system: (typeof architecture)[number]) {
  return item ? system.why : "No active work remains.";
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

function displayNode(run: LoopRunProjection | null | undefined) {
  if (!run) return "Direct work";
  const node = run.graph.nodes.find((candidate) => candidate.id === run.currentNode);
  return node?.role ?? node?.capability ?? run.currentNode;
}

function runItemId(run: LoopRunProjection) {
  const marker = run.itemRef.lastIndexOf("#");
  return marker >= 0 ? run.itemRef.slice(marker + 1) : run.itemRef;
}

function runSubsystem(run: LoopRunProjection | null) {
  if (!run) return null;
  const node = run.graph.nodes.find((candidate) => candidate.id === run.currentNode);
  const meaning = `${run.currentNode} ${node?.role ?? ""} ${node?.capability ?? ""}`;
  if (node?.kind === "check" || node?.kind === "gate" || /review|verify|validate/u.test(meaning)) return "proof";
  if (node?.kind === "agent") return "work";
  if (node?.kind === "terminal" || /converg|complete|burn/u.test(run.currentNode)) return "burn";
  return "loops";
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

function durationRange(range: { low: number; high: number } | null | undefined) {
  return range ? `${duration(range.low)}–${duration(range.high)}` : "Unavailable";
}

function tokenRange(range: { low: number; high: number } | null | undefined) {
  return range ? `${range.low.toLocaleString("en-US")}–${range.high.toLocaleString("en-US")}` : "Unavailable";
}

function observedTokens(run: LoopRunProjection | null, records: NonNullable<LoopRunProjection["activity"]>["records"]) {
  const telemetry = run?.execution?.telemetry;
  const observed = [...records].reverse().find((record) =>
    record.inputTokens !== null && record.inputTokens !== undefined
    || record.outputTokens !== null && record.outputTokens !== undefined);
  const input = telemetry?.inputTokens ?? observed?.inputTokens ?? null;
  const output = telemetry?.outputTokens ?? observed?.outputTokens ?? null;
  if (input === null && output === null) return "Unavailable";
  return `${((input ?? 0) + (output ?? 0)).toLocaleString("en-US")} reported`;
}

function proofSignals(run: LoopRunProjection | null) {
  if (!run) return "Unavailable";
  const labels = run.transitions.flatMap((transition) => {
    const node = run.graph.nodes.find((candidate) => candidate.id === transition.from);
    if (node?.kind === "check") return [`check ${transition.outcome}`];
    if (node?.kind === "gate") return [`gate ${transition.outcome}`];
    if (node?.kind === "agent" && /review/u.test(node.role ?? node.id)) return [`review ${transition.outcome}`];
    return [];
  });
  const active = run.graph.nodes.find((candidate) => candidate.id === run.currentNode);
  if (active?.kind === "check") labels.push("check running");
  if (active?.kind === "gate") labels.push("gate running");
  if (active?.kind === "agent" && /review/u.test(active.role ?? active.id)) labels.push("review waiting");
  return labels.slice(-3).join(" · ") || "No check, gate, or review result yet";
}

function canonicalState(run: LoopRunProjection | null, item: ChecklistItem | null) {
  const work = item?.work;
  if (work) return { state: work.state, progressing: work.progressing, reason: work.reason };
  if (!run) return { state: "PENDING", progressing: false, reason: "No canonical Run or claim." };
  if (run.diagnostic || ["needs-human", "failed", "stopped", "budget-exhausted", "corrupt"].includes(run.state)) {
    return { state: "BLOCKED", progressing: false, reason: `Run ${run.state}.` };
  }
  if (run.state === "running" && (run.hostTask === "claimed" || run.hostTask === "not-applicable")) {
    return { state: "ACTIVE", progressing: false, reason: "Canonical Run is active." };
  }
  return { state: "WAITING", progressing: false, reason: `Run ${run.state}.` };
}

export function LoopProgress({ data }: { data: ChecklistProgressData }) {
  const item = selectedItem(data);
  const system = subsystem(item);
  const authoritativeRun = data.loopRun ?? null;
  const runItem = authoritativeRun
    ? data.active.find((candidate) => authoritativeRun.itemRef.endsWith(`#${candidate.id}`)) ?? item
    : item;
  const workState = canonicalState(authoritativeRun, runItem);
  const itemRun = item && authoritativeRun?.itemRef.endsWith(`#${item.id}`) ? authoritativeRun : item ? preview(item) : null;
  const files = item?.fields["Files/search"] ?? "No declared file surface";
  const runningSystem = runSubsystem(authoritativeRun);
  const activity = authoritativeRun?.activity;
  const recentActivity = activity?.records.slice(-10) ?? [];
  const observedPaths = [...new Set(recentActivity.flatMap((record) => [
    ...(record.observedPath ? [record.observedPath] : []),
    ...(record.observedPaths ?? []),
  ]))];
  const observation = [...recentActivity].reverse().find((record) =>
    record.provider || record.model || record.effort);
  const observedAgent = observation
    ? [observation.provider, observation.model, observation.effort ? `effort ${observation.effort}` : null]
      .filter(Boolean).join(" · ")
    : "Unavailable";
  const forecast = authoritativeRun?.forecast;
  const provenance = forecast
    ? forecast.provenance.kind === "local-observations"
      ? `${forecast.confidence} · ${forecast.provenance.matchingObservations} local observations`
      : `${forecast.confidence} · built-in prior`
    : "Unavailable";
  const observedElapsed = authoritativeRun
    ? Math.max(
      authoritativeRun.budget.elapsedMilliseconds,
      ...recentActivity.map((record) => Math.max(0, record.at - authoritativeRun.createdAt)),
    )
    : null;
  const activeNode = authoritativeRun?.graph.nodes.find((node) => node.id === authoritativeRun.currentNode);
  const branch = authoritativeRun?.loopId.endsWith(":branch") || authoritativeRun?.loopId === "branch"
    ? authoritativeRun.currentNode : "not branched";
  const activityStatus = workState.state === "ACTIVE"
    ? workState.progressing ? "progressing" : "active · no recent hook"
    : workState.state.toLowerCase();
  const blocker = workState.state === "BLOCKED"
    ? authoritativeRun?.latestResult?.summary ?? workState.reason
    : "None canonical";
  const retries = authoritativeRun
    ? `attempt ${authoritativeRun.attempt || 1} · cycle ${authoritativeRun.cycle || 0}`
    : "Unavailable";
  return <section className="loop-progress" aria-label="Loop progress">
    <header className="loop-progress__now">
      <span>NOW</span>
      <strong>{authoritativeRun ? `${runItemId(authoritativeRun)} · ${displayNode(authoritativeRun)}` : item ? `${item.id} · ${item.title}` : "Complete"}</strong>
      <small>{authoritativeRun ? `Run · ${authoritativeRun.state} · ${workState.state}` : `${workState.state} · canonical checklist`}</small>
    </header>

    <div className="loop-progress__context-head"><span>CONTEXT</span><strong>{item ? `${item.id} · ${item.title}` : "None"}</strong></div>
    <div className="loop-progress__context">
      <article><span>WHY</span><p>{plainWhy(item, system)}</p></article>
      <article><span>SYSTEM</span><p>{system.label}</p></article>
      <article><span>HOOKS</span><p>{activity?.hooks ?? "Unavailable"}</p></article>
    </div>
    <div className="loop-progress__signals" aria-label="Live Loop signals">
      <article><span>STATE</span><p>{workState.state}{workState.progressing ? " · progressing" : ""}</p></article>
      <article><span>AGENT</span><p>{observedAgent}</p></article>
      <article><span>NODE / BRANCH</span><p>{activeNode?.role ?? activeNode?.capability ?? authoritativeRun?.currentNode ?? "Unavailable"} · {branch}</p></article>
      <article><span>ACTIVITY</span><p>{activityStatus} · hooks {activity?.hooks ?? "unavailable"}</p></article>
      <article><span>TIME</span><p>elapsed {duration(observedElapsed)} · forecast {durationRange(forecast?.wallTime)}</p></article>
      <article><span>TOKENS</span><p>{observedTokens(authoritativeRun, recentActivity)} · forecast {tokenRange(forecast?.totalTokens)}</p></article>
      <article><span>CHECK / GATE / REVIEW</span><p>{proofSignals(authoritativeRun)}</p></article>
      <article><span>BLOCKER / RETRIES</span><p>{blocker} · {retries}</p></article>
    </div>
    <div className="loop-progress__provenance">
      <b>PROVENANCE</b>
      <span>State, node, claim, checks, gates, and reviews: canonical Run. Activity, agent facts, paths, timing, and reported tokens: bounded observation only. Forecast: {provenance}.</span>
    </div>

    <div className="loop-progress__work">
      <section className="loop-progress__map" aria-label="Burnlist architecture">
        <h2>SYSTEM FLOW <small>whole Burnlist</small></h2>
        <ol>
          {architecture.map((part, index) => <li className={`${part.id === system.id ? "is-active" : ""}${part.id === runningSystem ? " is-running" : ""}`} key={part.id}>
            <span><strong>{part.label}</strong><small>{part.detail}</small>{part.id === runningSystem && <em>NOW</em>}{part.id === system.id && <em>CONTEXT</em>}</span>{index < architecture.length - 1 && <b aria-hidden="true">→</b>}
          </li>)}
        </ol>
      </section>
      <section className="loop-progress__loop" aria-label="Assigned Loop">
        <h2>LOOP <small>{item?.loop?.selector ?? "direct"}</small></h2>
        {itemRun ? <LoopCompact run={itemRun} labels="outcomes" title={`Loop for ${item?.id ?? "current item"}`} variant={item?.loop?.graph ? "topology" : "burn-cycle"} />
          : <p className="loop-progress__empty">No Loop assigned</p>}
      </section>
    </div>
    <section className="loop-progress__activity" aria-label="Recent observed activity">
      <h2>ACTIVITY <small>{activity ? `${recentActivity.length} recent` : "unavailable"}</small></h2>
      <ol>{recentActivity.length ? recentActivity.slice().reverse().map((record, index) => <li key={`${record.at}/${record.kind}/${index}`}>
        <b>{record.origin}</b><span>{activityText(record)}</span>{record.provider ? <small>{record.provider}</small> : null}{record.truncated ? <small>truncated</small> : null}
      </li>) : <li className="loop-progress__activity-empty">No observed hook activity. Runner state remains canonical.</li>}</ol>
      <div className="loop-progress__observed"><b>CODE CHANGES</b><span>{observedPaths.length ? observedPaths.join(" · ") : "Unavailable · observational only"}</span></div>
    </section>
    <footer><span>FILES</span> {files}<br/>Selected · {item ? `${item.id} ${item.title}` : "none"}{authoritativeRun && item && !authoritativeRun.itemRef.endsWith(`#${item.id}`) ? " · Run remains authoritative for another item" : ""}</footer>
  </section>;
}
