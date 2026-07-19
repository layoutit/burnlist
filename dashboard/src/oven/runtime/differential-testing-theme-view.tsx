import { DifferentialEmptyState } from "../DifferentialEmptyState/DifferentialEmptyState";
import { FieldMiniChart } from "../FieldMiniChart";
import type { FieldMiniChartField } from "../FieldMiniChart";
import { DifferentialKpiStrip } from "../DifferentialKpiStrip/DifferentialKpiStrip";
import { DifferentialLogTable } from "../DifferentialLogTable/DifferentialLogTable";
import { DifferentialFrameDeltaChart, DifferentialProgressChart } from "../DifferentialProgressChart";
import { RefreshStatusChip } from "../RefreshStatusChip/RefreshStatusChip";
import { resolvePointer } from "../utils/json-pointer";
import { ControlAdapter } from "./control-adapters";
import { DifferentialTestingDetail } from "./differential-testing-detail";
import { DifferentialTestingFields } from "./differential-testing-fields";
import type { OvenAction, OvenIr, OvenState } from "./oven-reducer";
import { selectMode, selectRefreshStatus } from "./oven-selectors";
import { getOvenTheme } from "./theme-registry";
import { WidgetAdapter } from "./widget-adapters";

type Node = {
  kind: string;
  attributes?: Record<string, unknown>;
  bindings?: Record<string, unknown>;
  children?: Node[];
};

type Props = {
  ir: OvenIr;
  state: OvenState;
  dispatch: (action: OvenAction) => void;
};

const attrs = (node: Node) => node.attributes ?? {};

function selectedChildren(node: Node, state: OvenState): Node[] {
  const source = attrs(node).source;
  const selected = typeof source === "string"
    ? resolvePointer(state.payload, source)
    : selectMode(state, String(attrs(node).modeFrom ?? ""));
  const branch = (node.children ?? []).find((child) => child.kind === "case" && attrs(child).value === selected)
    ?? (node.children ?? []).find((child) => child.kind === "case" && attrs(child).default === true);
  return branch?.children ?? [];
}

function activeNodes(nodes: Node[], state: OvenState): Node[] {
  return nodes.flatMap((node) => node.kind === "switch" ? activeNodes(selectedChildren(node, state), state) : [node]);
}

function required(nodes: Node[], kind: string): Node {
  const node = nodes.find((candidate) => candidate.kind === kind);
  if (!node) throw new Error(`Differential Testing theme requires <${kind}>`);
  return node;
}

function source(node: Node, payload: unknown): unknown {
  const pointer = attrs(node).source;
  return resolvePointer(payload, typeof pointer === "string" ? pointer : "/");
}

function componentDefaults(ir: OvenIr, kind: string): Record<string, unknown> {
  return { ...(getOvenTheme(ir.theme)?.components[kind] ?? {}) };
}

export function DifferentialTestingThemeView({ ir, state, dispatch }: Props) {
  const root = activeNodes(ir.root as Node[] ?? [], state);
  const empty = root.find((node) => node.kind === "differential-empty-state");
  if (empty) {
    const title = attrs(empty).title;
    const value = typeof title === "string" && title.startsWith("/") ? resolvePointer(state.payload, title) : title;
    return <DifferentialEmptyState title={String(value || "Differential Testing")} />;
  }

  const refreshNode = required(root, "refresh-status");
  const kpiNode = required(root, "differential-kpi-strip");
  const logNode = required(root, "differential-log-table");
  const toolbarNode = required(root, "field-toolbar");
  const collectionNode = required(root, "collection");
  const fieldNode = required(collectionNode.children ?? [], "field-list");
  const paginationNode = required(collectionNode.children ?? [], "pagination");
  const progressNode = root.find((node) => node.kind === "progress-chart" || node.kind === "frame-delta-chart");
  if (!progressNode) throw new Error("Differential Testing theme requires a chart node");

  const payload = state.payload as Record<string, unknown>;
  const progressMode = selectMode(state, "progress-mode") ?? "delta";
  const primaryChartTitle = typeof payload.primaryChartTitle === "string" ? payload.primaryChartTitle : "";
  const primaryChartField = payload.primaryChartField as FieldMiniChartField | undefined;
  const chart = primaryChartField
    ? <div id="progress-chart" className="chart hybrid-chart" role="img" aria-label={`${primaryChartTitle} over time`}>
      <FieldMiniChart field={primaryChartField} showFrameLabels chartMode={progressMode === "delta" ? "delta" : "value"} />
    </div>
    : progressNode.kind === "frame-delta-chart"
      ? <DifferentialFrameDeltaChart metrics={source(progressNode, state.payload) as any} {...componentDefaults(ir, progressNode.kind) as any} />
      : <DifferentialProgressChart history={source(progressNode, state.payload) as any[]} {...componentDefaults(ir, progressNode.kind) as any} />;
  const fieldsMetric = payload.summary && typeof payload.summary === "object"
    ? (payload.summary as { fields?: { total?: unknown } }).fields
    : undefined;
  const refreshPhase = selectRefreshStatus(state).phase;

  return <>
    <DifferentialTestingDetail
      payload={payload}
      progressMode={progressMode}
      refresh={<RefreshStatusChip refresh={source(refreshNode, state.payload) as any} clientStatus={refreshPhase === "idle" ? null : refreshPhase} />}
      kpis={<DifferentialKpiStrip payload={source(kpiNode, state.payload) as any} />}
      chart={chart}
      log={<DifferentialLogTable entries={source(logNode, state.payload) as any[]} />}
    />
    <DifferentialTestingFields
      total={fieldsMetric?.total}
      toolbar={<ControlAdapter node={toolbarNode} ir={ir} state={state} dispatch={dispatch} />}
      fields={<WidgetAdapter node={fieldNode} ir={ir} state={state} />}
      pagination={<ControlAdapter node={paginationNode} ir={ir} state={state} dispatch={dispatch} />}
    />
  </>;
}
