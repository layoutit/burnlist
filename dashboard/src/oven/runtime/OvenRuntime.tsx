import { createContext, createElement, Fragment, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { OvenNode, isStaticOvenDocument } from "./OvenNode";
import { OvenView } from "../OvenView/OvenView";
import { lowerOvenIr } from "./lower-oven-ir";
import { ovenSnapshotSearch, useOvenLiveData, type OvenPayloadAdapter } from "./oven-live-data";
import { initOvenState, ovenReducer, type OvenAction, type OvenControlSeed, type OvenIr, type OvenPageSeed, type OvenState } from "./oven-reducer";
import { getOvenTheme } from "./theme-registry";
import { DifferentialTestingThemeView } from "./differential-testing-theme-view";
import "./oven-runtime-state.css";

export const OvenRuntimeContext = createContext<{ state: OvenState; dispatch: (action: OvenAction) => void } | null>(null);
type RootNode = NonNullable<OvenIr["root"]>[number];
type RuntimeStateKind = "error" | "loading" | "stale";

function OvenRuntimeState({ detail, kind, title }: { detail: string; kind: RuntimeStateKind; title: string }) {
  const failed = kind === "error";
  return <div className={`oven-runtime-state is-${kind}`} role={failed ? "alert" : "status"}>
    <span aria-hidden="true" className="oven-runtime-state-indicator" />
    <span className="oven-runtime-state-copy">
      <strong className="oven-runtime-state-title">{title}</strong>
      <span className="oven-runtime-state-detail">{detail}</span>
    </span>
  </div>;
}

export function resolveOvenRuntimeInputs({ initialPayload, payload, refreshSeconds }: {
  initialPayload?: unknown;
  payload?: unknown;
  refreshSeconds?: unknown;
}) {
  const controlled = payload !== undefined;
  return {
    inputPayload: controlled ? payload : initialPayload,
    live: !controlled,
    refreshSeconds: controlled ? undefined : refreshSeconds,
  };
}

export function themedRegions(root: RootNode[], theme: ReturnType<typeof getOvenTheme>, renderNode: (node: RootNode, index: number) => ReactNode): ReactNode | undefined {
  if (!theme) return undefined;
  const expected = theme.regions.flatMap((region) => region.kinds);
  if (root.length !== expected.length || root.some((node, index) => node.kind !== expected[index])) return undefined;
  let cursor = 0;
  return theme.regions.map((region, regionIndex) => {
    const children = root.slice(cursor, cursor + region.kinds.length).map((node, index) => renderNode(node, cursor + index));
    cursor += region.kinds.length;
    return createElement(region.element === "fragment" ? Fragment : region.element, {
      key: `theme-${regionIndex}`,
      ...(region.className ? { className: region.className } : {}),
      ...region.props,
    }, children);
  });
}

export function OvenRuntime({ ir, initialPayload, payload, controls, pages, initialAction, adapt }: { ir: OvenIr & { id?: string; refreshSeconds?: number }; initialPayload?: unknown; payload?: unknown; controls?: OvenControlSeed; pages?: OvenPageSeed; initialAction?: OvenAction; adapt?: OvenPayloadAdapter }) {
  const { inputPayload, live, refreshSeconds } = resolveOvenRuntimeInputs({ initialPayload, payload, refreshSeconds: ir.refreshSeconds });
  const [state, dispatch] = useReducer((current: OvenState, action: OvenAction) => ovenReducer(current, action, ir), inputPayload, (nextPayload) => {
    const initialState = initOvenState(ir, nextPayload, controls, pages);
    return initialAction ? ovenReducer(initialState, initialAction, ir) : initialState;
  });
  const snapshotSearch = useMemo(() => ovenSnapshotSearch({ ir, state, scenario: state.scenario }), [ir, state, state.scenario]);
  useOvenLiveData(live ? ir.id : undefined, refreshSeconds, dispatch, snapshotSearch, adapt);
  useEffect(() => {
    if (payload !== undefined) dispatch({ type: "payloadAccepted", payload });
  }, [payload]);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  const root = ir.root ?? [];
  const theme = getOvenTheme(ir.theme);
  const themedView = theme?.runtimeLayout === "differential-testing" ? <DifferentialTestingThemeView ir={ir} state={state} dispatch={dispatch} /> : null;
  const emptyState = !themedView && state.payload === undefined
    ? state.refresh.phase === "failed"
      ? <OvenRuntimeState detail={String(state.refresh.error || "Could not load Oven data.")} kind="error" title="Oven data unavailable" />
      : <OvenRuntimeState detail="Waiting for the canonical snapshot." kind="loading" title="Loading Oven data" />
    : null;
  const staleState = state.payload !== undefined && state.refresh.stale
    ? state.refresh.phase === "failed"
      ? <OvenRuntimeState detail={`Showing the last canonical snapshot. ${String(state.refresh.error || "Canonical refresh failed.")}`} kind="error" title="Canonical refresh failed" />
      : <OvenRuntimeState detail="Showing the last canonical snapshot while canonical data refreshes." kind="stale" title="Refreshing canonical data" />
    : null;
  const staticView = !themedView && root.every(isStaticOvenDocument) ? <OvenView def={lowerOvenIr(ir)} payload={state.payload as any} /> : null;
  const regions = themedRegions(root, theme, (node, index) => <OvenNode key={index} node={node} ir={ir} state={state} dispatch={dispatch} />);
  const genericBody = regions ?? <>{root.map((node, index) => <OvenNode key={index} node={node} ir={ir} state={state} dispatch={dispatch} />)}</>;
  const genericView = regions && (theme?.view.shellClassName || theme?.view.bodyClassName || theme?.view.bodyId)
    ? <div className={theme.view.shellClassName}><main className={theme.view.bodyClassName} id={theme.view.bodyId}>{genericBody}</main></div>
    : genericBody;
  return <OvenRuntimeContext.Provider value={value}>{staleState}{emptyState ?? themedView ?? staticView ?? genericView}</OvenRuntimeContext.Provider>;
}
