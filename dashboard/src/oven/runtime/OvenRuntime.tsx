import { createContext, useMemo, useReducer } from "react";
import { OvenNode } from "./OvenNode";
import { useOvenLiveData } from "./oven-live-data";
import { initOvenState, ovenReducer, type OvenAction, type OvenIr, type OvenState } from "./oven-reducer";

export const OvenRuntimeContext = createContext<{ state: OvenState; dispatch: (action: OvenAction) => void } | null>(null);
export function OvenRuntime({ ir, initialPayload }: { ir: OvenIr & { id?: string; refreshSeconds?: number }; initialPayload?: unknown }) {
  const [state, dispatch] = useReducer((current: OvenState, action: OvenAction) => ovenReducer(current, action, ir), initialPayload, (payload) => initOvenState(ir, payload));
  useOvenLiveData(ir.id, ir.refreshSeconds, dispatch);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <OvenRuntimeContext.Provider value={value}><>{(ir.root ?? []).map((node, index) => <OvenNode key={index} node={node} ir={ir} state={state} dispatch={dispatch} />)}</></OvenRuntimeContext.Provider>;
}
