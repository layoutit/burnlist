import { createContext, createElement, Fragment, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { OvenNode, isStaticOvenDocument } from "./OvenNode";
import { OvenView } from "../OvenView/OvenView";
import { lowerOvenIr } from "./lower-oven-ir";
import { useOvenLiveData } from "./oven-live-data";
import { initOvenState, ovenReducer, type OvenAction, type OvenControlSeed, type OvenIr, type OvenPageSeed, type OvenState } from "./oven-reducer";
import { getOvenTheme } from "./theme-registry";
import { DifferentialTestingThemeView } from "./differential-testing-theme-view";

export const OvenRuntimeContext = createContext<{ state: OvenState; dispatch: (action: OvenAction) => void } | null>(null);
type RootNode = NonNullable<OvenIr["root"]>[number];

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

export function OvenRuntime({ ir, initialPayload, payload, controls, pages }: { ir: OvenIr & { id?: string; refreshSeconds?: number }; initialPayload?: unknown; payload?: unknown; controls?: OvenControlSeed; pages?: OvenPageSeed }) {
  const inputPayload = payload === undefined ? initialPayload : payload;
  const [state, dispatch] = useReducer((current: OvenState, action: OvenAction) => ovenReducer(current, action, ir), inputPayload, (nextPayload) => initOvenState(ir, nextPayload, controls, pages));
  useOvenLiveData(ir.id, ir.refreshSeconds, dispatch);
  useEffect(() => {
    if (payload !== undefined) dispatch({ type: "payloadAccepted", payload });
  }, [payload]);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  const root = ir.root ?? [];
  const theme = getOvenTheme(ir.theme);
  const themedView = theme?.runtimeLayout === "differential-testing" ? <DifferentialTestingThemeView ir={ir} state={state} dispatch={dispatch} /> : null;
  const staticView = !themedView && root.every(isStaticOvenDocument) ? <OvenView def={lowerOvenIr(ir)} payload={state.payload as any} /> : null;
  const genericView = themedRegions(root, theme, (node, index) => <OvenNode key={index} node={node} ir={ir} state={state} dispatch={dispatch} />) ?? <>{root.map((node, index) => <OvenNode key={index} node={node} ir={ir} state={state} dispatch={dispatch} />)}</>;
  return <OvenRuntimeContext.Provider value={value}>{themedView ?? staticView ?? genericView}</OvenRuntimeContext.Provider>;
}
