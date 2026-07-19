import { HybridFieldList } from "../HybridFieldList/HybridFieldList";
import { RefreshStatusChip } from "../RefreshStatusChip/RefreshStatusChip";
import { formatRegistry } from "../OvenView/registries";
import { resolvePointer } from "../utils/json-pointer";
import type { OvenIr, OvenState } from "./oven-reducer";
import { selectCollection, selectMode, selectRefreshStatus } from "./oven-selectors";

type Node = { kind: string; attributes?: Record<string, unknown>; children?: Node[] };
const attrs = (node: Node) => node.attributes ?? {};

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
    return <HybridFieldList fields={collection.pageItems as any[]} chartMode={mode} sort={state.controls[String(ir.collections.find((item) => item.id === collectionId)?.sortFrom ?? "")] === true ? "changed" : "default"}
      telemetryByField={bind(node, "telemetryByField", state.payload) as any} telemetryAvailability={bind(node, "telemetryAvailability", state.payload) as any} />;
  }
  return null;
}
