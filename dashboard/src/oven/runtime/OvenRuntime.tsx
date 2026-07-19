import { createContext, useEffect, useMemo, useReducer } from "react";
import { OvenNode, isStaticOvenDocument } from "./OvenNode";
import { OvenView } from "../OvenView/OvenView";
import { lowerOvenIr } from "./lower-oven-ir";
import { useOvenLiveData } from "./oven-live-data";
import { initOvenState, ovenReducer, type OvenAction, type OvenControlSeed, type OvenIr, type OvenState } from "./oven-reducer";
import { getOvenTheme } from "./theme-registry";
import { DifferentialTestingThemeView } from "./differential-testing-theme-view";

export const OvenRuntimeContext = createContext<{ state: OvenState; dispatch: (action: OvenAction) => void } | null>(null);
export function OvenRuntime({ ir, initialPayload, payload, controls }: { ir: OvenIr & { id?: string; refreshSeconds?: number }; initialPayload?: unknown; payload?: unknown; controls?: OvenControlSeed }) {
  const inputPayload = payload === undefined ? initialPayload : payload;
  const [state, dispatch] = useReducer((current: OvenState, action: OvenAction) => ovenReducer(current, action, ir), inputPayload, (nextPayload) => initOvenState(ir, nextPayload, controls));
  useOvenLiveData(ir.id, ir.refreshSeconds, dispatch);
  useEffect(() => {
    if (payload !== undefined) dispatch({ type: "payloadAccepted", payload });
  }, [payload]);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  const root = ir.root ?? [];
  const theme = getOvenTheme(ir.theme);
  const themedView = theme?.runtimeLayout === "differential-testing" ? <DifferentialTestingThemeView ir={ir} state={state} dispatch={dispatch} /> : null;
  const staticView = !themedView && root.every(isStaticOvenDocument) ? <OvenView def={lowerOvenIr(ir)} payload={state.payload as any} /> : null;
  return <OvenRuntimeContext.Provider value={value}>{themedView ?? staticView ?? <>{root.map((node, index) => <OvenNode key={index} node={node} ir={ir} state={state} dispatch={dispatch} />)}</>}</OvenRuntimeContext.Provider>;
}
