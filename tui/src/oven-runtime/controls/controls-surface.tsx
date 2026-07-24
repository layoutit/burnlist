import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { controlsAction, controlsInitialState, controlsPage, controlsFixture, type ControlsState } from "./controls-fixture";

const clip = (text: string, width: number) => Array.from(text).length > width ? `${Array.from(text).slice(0, Math.max(1, width - 1)).join("")}…` : text;
export function InteractiveControlsSurface({ onBack, onView, showFooter = true }: {
  onBack?(): void;
  onView?(): void;
  showFooter?: boolean;
}) {
  const [state, setState] = useState(controlsInitialState);
  useKeyboard((key) => {
    const pressed = key.name ?? key.sequence;
    if (pressed === "q") { onBack?.(); return; }
    if (pressed === "v" && onView) { onView(); return; }
    setState((value) => controlsAction(value, pressed));
  });
  return <ControlsSurface state={state} showFooter={showFooter} />;
}
export function ControlsSurface({ state, showFooter = true }: { state: ControlsState; showFooter?: boolean }) {
  const page = controlsPage(state), focused = (name: string) => state.focus === name ? "›" : " ";
  return <box width="100%" height="100%" flexDirection="column" backgroundColor="#151719" paddingLeft={1} paddingRight={1} overflow="hidden">
    <box height={1} flexDirection="row"><text fg="#e8e8e8">{controlsFixture.tabs.map((tab, index) => `${index === state.tab ? "●" : "○"} ${tab.label}${tab.failed ? ` !${tab.failed}` : ""}`).join("  ")}</text></box>
    <box height={1}><text fg="#a8a8a8">{focused("search")}Search: {clip(state.query || "(type to search)", 28)}</text></box>
    <box height={1}><text fg="#a8a8a8">{focused("filter")}{state.filter ? "[x]" : "[ ]"} Failed   {focused("sort")}[×] Changed (unavailable)</text></box>
    <box flexGrow={1} flexDirection="column" overflow="hidden" paddingTop={1}>{page.rows.map((row) => <text key={(row as { id: string }).id} fg="#e8e8e8">· {clip((row as { label: string }).label, 30)}</text>)}{!page.rows.length ? <text fg="#84888f">No matching fields.</text> : null}<text fg="#d78b4a">{state.notice}</text></box>
    <box height={1}><text fg="#a8a8a8">{focused("prev")}[←] Prev  {page.page + 1}/{page.count}  {focused("next")}[→] Next</text></box>
    {showFooter ? <box height={2} border={["top"]} borderColor="#3a3a40" alignItems="center"><text fg="#84888f">q:back · tab:focus · enter:toggle</text></box> : null}
  </box>;
}
