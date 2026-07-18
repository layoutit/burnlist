import type { ReactNode } from "react";
import { BurnDonut, burnDonutCounts } from "../BurnDonut/BurnDonut";
import { DifferentialKpiItem } from "../DifferentialKpiItem/DifferentialKpiItem";
import { KpiStrip } from "../KpiStrip/KpiStrip";
import { ProgressDonut } from "../ProgressDonut/ProgressDonut";
import { WaffleMetric } from "../WaffleMetric/WaffleMetric";
import { blockers, count, dateTime, kpiTotal, percent, unique } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";

type Scenario = { id: string };
type ProgressEntry = { frames?: number; frame?: number };
type BurnEntry = { result?: string };
type Metric = { total?: number; failed?: number; blocked?: number };

export type DifferentialPayload = {
  scenarioCatalog?: { selectedScenarioId?: string | null; scenarios?: Scenario[] };
  progress?: ProgressEntry[];
  log?: BurnEntry[];
  summary?: { fields?: Metric; frames?: Metric };
  subtitle?: string;
  publishedAt?: string;
  telemetry?: { status?: string; summary?: { failToPassCount?: number; passToFailCount?: number }; blockers?: unknown[] };
  trust?: { status?: string; blockers?: unknown[] };
  exactSession?: { status?: string; blockers?: unknown[] };
};

type DifferentialKpiData = {
  scenario: {
    title: string;
    selectedScenarioId: string;
    scenarios: Scenario[];
  };
  progress: { title: string; total: number; done: number; donePercent: number };
  burns: { title: string; counts: ReturnType<typeof burnDonutCounts>; improvedPercent: number };
  fields: { metric: Metric; failed: number; ratio: number; failedCells: number; empty: boolean };
  frames: { metric: Metric; failed: number; ratio: number; failedCells: number; empty: boolean };
};

function trustBlockerSummaries(payload: DifferentialPayload): string[] {
  const result: string[] = [];
  const append = (label: string, status: string | undefined, entries: unknown[] | undefined) => {
    if (status !== "blocked") return;
    const reasons = blockers(entries);
    result.push(`${label} blocked${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
  };
  append("primary", payload.trust?.status, payload.trust?.blockers);
  append("telemetry", payload.telemetry?.status, payload.telemetry?.blockers);
  append("exact", payload.exactSession?.status, payload.exactSession?.blockers);
  return unique(result);
}

function metricData(metric: Metric = {}) {
  const failed = Number(metric.failed || 0) + Number(metric.blocked || 0);
  const ratio = metric.total ? failed / metric.total : 0;
  return {
    metric,
    failed,
    ratio,
    failedCells: Math.min(80, Math.round(ratio * 96)),
    empty: metric.total ? false : true,
  };
}

export function buildDifferentialKpiData(payload: DifferentialPayload): DifferentialKpiData {
  const catalog = payload.scenarioCatalog ?? {};
  const scenarios = Array.isArray(catalog.scenarios) ? catalog.scenarios : [];
  const selectedScenarioId = catalog.selectedScenarioId || "";
  const latest = payload.progress?.[payload.progress.length - 1];
  const total = Math.max(0, Number(latest?.frames) || 0);
  const done = Math.max(0, Math.min(total, Number(latest?.frame) || 0));
  const donePercent = total ? done / total * 100 : 0;
  const counts = burnDonutCounts(payload.log ?? []);
  const burnTotal = Object.values(counts).reduce((sum, amount) => sum + amount, 0);
  const subtitleParts = [payload.subtitle, dateTime(payload.publishedAt), payload.telemetry?.status === "comparable"
    ? `${count(payload.telemetry.summary?.failToPassCount)} F→P · ${count(payload.telemetry.summary?.passToFailCount)} P→F · reconciled telemetry only`
    : "", ...trustBlockerSummaries(payload)].filter(Boolean);

  return {
    scenario: {
      title: subtitleParts.join(" · "),
      selectedScenarioId,
      scenarios,
    },
    progress: { title: `${count(done)} of ${count(total)} exact-prefix frames cleared`, total, done, donePercent },
    burns: {
      title: "Results across the current Differential Testing run",
      counts,
      improvedPercent: burnTotal ? counts.improved / burnTotal * 100 : 0,
    },
    fields: metricData(payload.summary?.fields),
    frames: metricData(payload.summary?.frames),
  };
}

function progressValue(data: DifferentialKpiData["progress"]): ReactNode {
  return <><span className="fail">{count(data.total)}</span><span className="separator">·</span><span className="pass">{count(data.done)} ({percent(data.donePercent)})</span></>;
}

function burnsValue(data: DifferentialKpiData["burns"]): ReactNode {
  const { counts } = data;
  return <><span className="neutral">{count(counts.unchanged)}</span><span className="separator">·</span><span className="reverted">{count(counts.reverted)}</span><span className="separator">·</span><span className="worsened">{count(counts.worsened)}</span><span className="separator">·</span><span className="improved">{count(counts.improved)} ({percent(data.improvedPercent)})</span></>;
}

function waffleValue(data: DifferentialKpiData["fields"] | DifferentialKpiData["frames"]): ReactNode {
  return <><span className="total">{kpiTotal(data.metric.total)}</span><span className="separator">·</span><span className="fail">{kpiTotal(data.failed)} ({percent(data.ratio * 100)})</span></>;
}

/**
 * Assumes a strip-bearing payload. When scenarioCatalog.selectedScenarioId is null and scenarioCatalog.scenarios is empty,
 * the vanilla renderer shows differential-testing-empty-state; region-8 assembly must branch to that empty state instead.
 */
export function DifferentialKpiStrip({ payload, onScenarioChange }: { payload: DifferentialPayload; onScenarioChange?: (id: string) => void }) {
  const data = buildDifferentialKpiData(payload);
  const scenarioVisual = <svg className="driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </svg>;
  const scenarioValue = <span className="differential-scenario-control"><select
    id="differential-scenario-selector"
    aria-label="Differential Testing scenario"
    defaultValue={data.scenario.selectedScenarioId}
    disabled={data.scenario.scenarios.length < 2}
    onChange={(event) => onScenarioChange?.(event.target.value)}
  >{data.scenario.scenarios.map((scenario) => <option value={scenario.id} key={scenario.id}>{scenario.id}</option>)}</select></span>;

  return <KpiStrip id="driving-parity-kpi-strip" className="driving-parity-kpi-strip has-burns" ariaLabel="Differential Testing field KPIs">
    <DifferentialKpiItem className="driving-parity-kpi-scenario" title={data.scenario.title} visual={scenarioVisual} heading="Scenario" headingClass="differential-scenario-heading" value={scenarioValue} />
    <DifferentialKpiItem className="driving-parity-kpi-progress" title={data.progress.title} visual={<ProgressDonut percent={data.progress.donePercent} />} heading="Progress" value={progressValue(data.progress)} />
    <DifferentialKpiItem className="driving-parity-kpi-burns" title={data.burns.title} visual={<BurnDonut entries={payload.log ?? []} />} heading="Results" valueClass="driving-parity-kpi-burns-summary" value={burnsValue(data.burns)} />
    <DifferentialKpiItem className="driving-parity-kpi-fields" title={`${percent(data.fields.ratio * 100)} failed fields`} visual={<WaffleMetric metric={data.fields.metric} />} heading="Fields" value={waffleValue(data.fields)} />
    <DifferentialKpiItem className="driving-parity-kpi-frames" title={`${percent(data.frames.ratio * 100)} failed frames`} visual={<WaffleMetric metric={data.frames.metric} />} heading="Frames" value={waffleValue(data.frames)} />
  </KpiStrip>;
}
