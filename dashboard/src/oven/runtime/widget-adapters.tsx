import { HybridFieldList } from "../HybridFieldList/HybridFieldList";
import { RefreshStatusChip } from "../RefreshStatusChip/RefreshStatusChip";
import { ChecklistBurnPanel } from "../ChecklistBurnPanel/ChecklistBurnPanel";
import { ChecklistEventCards } from "../ChecklistEventCards/ChecklistEventCards";
import { ChecklistLedger } from "../ChecklistLedger/ChecklistLedger";
import { DomainNote } from "../DomainNote";
import { FrameCard } from "../FrameCard";
import { MetricTiles } from "../MetricTiles";
import { VerdictHeader } from "../VerdictHeader";
import { formatRegistry } from "../OvenView/registries";
import { resolvePointer } from "../utils/json-pointer";
import type { OvenIr, OvenState } from "./oven-reducer";
import { selectCollection, selectDomain, selectMode, selectRefreshStatus } from "./oven-selectors";

type Node = { kind: string; attributes?: Record<string, unknown>; children?: Node[] };
const attrs = (node: Node) => node.attributes ?? {};

function nodes(items: Node[] = []): Node[] { return items.flatMap((item) => [item, ...nodes(item.children)]); }

function collectionControlId(ir: OvenIr, collectionId: string, name: string): string {
  const collection = nodes(ir.root as Node[] ?? []).find((item) => item.kind === "collection" && attrs(item).id === collectionId);
  const value = collection ? attrs(collection)[name] : ir.collections.find((item) => item.id === collectionId)?.[name];
  return typeof value === "string" ? value : "";
}

function bind(node: Node, prop: string, payload: unknown): unknown {
  const child = (node.children ?? []).find((item) => item.kind === "bind" && item.attributes?.prop === prop);
  if (!child || typeof child.attributes?.source !== "string") return undefined;
  const format = formatRegistry[String(child.attributes.format ?? "identity")];
  return format?.(resolvePointer(payload, child.attributes.source));
}

export function WidgetAdapter({ node, ir, state }: { node: Node; ir: OvenIr; state: OvenState }) {
  if (node.kind === "refresh-status") return <RefreshStatusChip refresh={resolvePointer(state.payload, String(attrs(node).source ?? "/")) as { status?: string; error?: string }} clientStatus={selectRefreshStatus(state).phase} />;
  if (node.kind === "field-list") {
    const collectionId = String(attrs(node).collectionFrom ?? "");
    const collection = selectCollection(state, ir, collectionId, resolvePointer);
    const mode = selectMode(state, String(attrs(node).modeFrom ?? "")) ?? "current";
    return <HybridFieldList fields={collection.pageItems as any[]} chartMode={mode} sort={state.controls[collectionControlId(ir, collectionId, "sortFrom")] === true ? "changed" : "default"}
      telemetryByField={bind(node, "telemetryByField", state.payload) as any} telemetryAvailability={bind(node, "telemetryAvailability", state.payload) as any} />;
  }
  if (node.kind === "verdict-header") return <VerdictHeader targetPass={bind(node, "targetPass", state.payload) as boolean} framesCount={bind(node, "framesCount", state.payload) as number} error={bind(node, "error", state.payload) as string} />;
  const selectionFrom = attrs(node).selectionFrom;
  const selected = typeof selectionFrom === "string" ? selectDomain(state, selectionFrom) : undefined;
  const source = attrs(node).source;
  const bySelection = typeof source === "string" ? resolvePointer(state.payload, source) as Record<string, unknown> | undefined : undefined;
  const scope = selected && bySelection ? bySelection[selected] : undefined;
  if (node.kind === "metric-tiles") return <MetricTiles passed={bind(node, "passed", scope) as number} total={bind(node, "total", scope) as number} ratio={bind(node, "ratio", scope) as number} meanAbsoluteDelta={bind(node, "meanAbsoluteDelta", scope) as number} maximumAbsoluteDelta={bind(node, "maximumAbsoluteDelta", scope) as number} />;
  if (node.kind === "domain-note") return <DomainNote isTarget={bind(node, "isTarget", scope) as boolean} rationale={bind(node, "rationale", scope) as string} />;
  if (node.kind === "frame-card") {
    const frames = scope && typeof scope === "object" && Array.isArray((scope as { frames?: unknown }).frames) ? (scope as { frames: Array<any> }).frames : [];
    return <div className="visual-parity-frames">{frames.map((frame, index) => <FrameCard key={frame.frame ?? index} status={frame.status} frame={frame.frame} difference={frame.difference} images={frame.images} label={frame.label} />)}</div>;
  }
  return null;
}

export function ChecklistWidgetAdapter({ node, payload }: { node: Node; payload: unknown }) {
  const data = resolvePointer(payload, String(attrs(node).source ?? "/")) as any;
  if (node.kind === "checklist-burn-panel") return <ChecklistBurnPanel data={data} />;
  if (node.kind === "checklist-ledger") return <ChecklistLedger data={data} />;
  if (node.kind === "checklist-event-cards") return <ChecklistEventCards data={data} />;
  return null;
}
