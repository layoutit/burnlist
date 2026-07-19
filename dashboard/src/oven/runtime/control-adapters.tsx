import { FieldToolbar } from "../FieldToolbar/FieldToolbar";
import { DomainTabs } from "../DomainTabs";
import { formatRegistry } from "../OvenView/registries";
import { PaginationBar } from "../PaginationBar/PaginationBar";
import { ToggleGroup } from "../ToggleGroup/ToggleGroup";
import { resolvePointer } from "../utils/json-pointer";
import type { OvenAction, OvenIr, OvenState } from "./oven-reducer";
import { selectCollection, selectDomain, selectMode } from "./oven-selectors";

type Node = { kind: string; attributes?: Record<string, unknown>; children?: Node[] };
type Props = { node: Node; ir: OvenIr; state: OvenState; dispatch: (action: OvenAction) => void };
const attrs = (node: Node) => node.attributes ?? {};
const id = (node: Node) => String(attrs(node).id ?? "");
const controls = (node: Node) => (node.children ?? []);

function byKind(node: Node, kind: string): Node | undefined { return controls(node).find((child) => child.kind === kind); }
function control(ir: OvenIr, controlId: string): Record<string, unknown> { return ir.controls.find((item) => item.id === controlId) ?? {}; }
function available(node: Node, state: OvenState): boolean {
  const source = attrs(node).requiresSource, expected = attrs(node).requiresValue;
  return typeof source !== "string" || resolvePointer(state.payload, source) === expected;
}
function unavailableText(node: Node, state: OvenState): string {
  const telemetry = formatRegistry["telemetry-availability"](resolvePointer(state.payload, "/telemetry"));
  return telemetry && typeof telemetry === "object" && typeof (telemetry as { reason?: unknown }).reason === "string"
    ? (telemetry as { reason: string }).reason
    : String(attrs(node).unavailableText ?? "");
}

export function ModeToggleAdapter({ node, state, dispatch }: Props) {
  const controlId = id(node), selected = selectMode(state, controlId);
  return <ToggleGroup id={controlId} className="chart-toggle differential-tabs" ariaLabel={String(attrs(node).ariaLabel ?? controlId)}>
    {controls(node).filter((child) => child.kind === "option").map((option) => {
      const value = String(attrs(option).value), label = String(attrs(option).label ?? value);
      return <button key={value} type="button" aria-pressed={selected === value} onClick={() => dispatch({ type: "modeSelected", id: controlId, value })}>{label}</button>;
    })}
  </ToggleGroup>;
}

export function DomainTabsAdapter({ node, state, dispatch }: Props) {
  const controlId = id(node);
  return <DomainTabs tabs={resolvePointer(state.payload, String(attrs(node).source ?? "/")) as any[]} activeId={selectDomain(state, controlId) ?? ""} onSelect={(selectedId) => dispatch({ type: "domainSelected", id: controlId, selectedId })} />;
}

export function FieldToolbarAdapter({ node, ir, state, dispatch }: Props) {
  const search = byKind(node, "search"), mode = byKind(node, "mode-toggle"), sort = byKind(node, "sort-toggle"), filter = byKind(node, "filter-toggle");
  const sortId = sort ? id(sort) : "", filterId = filter ? id(filter) : "";
  const isAvailable = !sort || available(sort, state);
  return <FieldToolbar
    chart={(mode && selectMode(state, id(mode)) === "current") ? "current" : "delta"}
    sort={state.controls[sortId] === true ? String(attrs(sort!).key ?? "changed") : ""}
    filter={state.controls[filterId] === true ? "failing" : ""}
    changedUnavailable={!isAvailable}
    changedReason={sort ? unavailableText(sort, state) : ""}
    onSearchInput={search ? (query) => dispatch({ type: "queryChanged", id: id(search), query }) : undefined}
    onSelectChart={mode ? (value) => dispatch({ type: "modeSelected", id: id(mode), value }) : undefined}
    onToggleSort={sort && isAvailable ? () => dispatch({ type: "toggleChanged", id: sortId, active: state.controls[sortId] !== true }) : undefined}
    onToggleFilter={filter ? () => dispatch({ type: "toggleChanged", id: filterId, active: state.controls[filterId] !== true }) : undefined}
  />;
}

export function PaginationAdapter({ node, ir, state, dispatch }: Props) {
  const collectionId = String(attrs(node).collectionFrom ?? "");
  const page = selectCollection(state, ir, collectionId, resolvePointer);
  const start = page.totalCount === 0 ? 0 : page.pageIndex * page.pageSize + 1;
  const end = page.totalCount === 0 ? 0 : Math.min(page.totalCount, start + page.pageItems.length - 1);
  return <PaginationBar pageSize={page.pageSize} pageIndex={page.pageIndex} pageCount={page.pageCount} start={start} end={end} total={page.totalCount}
    onPrev={() => dispatch({ type: "pagePrevious", collectionId })} onNext={() => dispatch({ type: "pageNext", collectionId })}
    onPageSizeChange={(pageSize) => dispatch({ type: "pageSizeChanged", collectionId, pageSize })} />;
}

/** Generic direct control entry point, including controls not hosted by FieldToolbar. */
export function ControlAdapter(props: Props) {
  if (props.node.kind === "mode-toggle") return <ModeToggleAdapter {...props} />;
  if (props.node.kind === "domain-tabs") return <DomainTabsAdapter {...props} />;
  if (props.node.kind === "field-toolbar") return <FieldToolbarAdapter {...props} />;
  if (props.node.kind === "pagination") return <PaginationAdapter {...props} />;
  return null;
}
