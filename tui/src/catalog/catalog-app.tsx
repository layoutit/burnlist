import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
// @ts-expect-error The Oven compiler is intentionally JavaScript.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
import progressSource from "./progress-fixture.oven" with { type: "text" };
import structuralSource from "./structural-fixture.oven" with { type: "text" };
import statusSource from "./status-fixture.oven" with { type: "text" };
import statusEmptySource from "./status-empty-fixture.oven" with { type: "text" };
import visualParitySource from "../../../ovens/visual-parity/visual-parity.oven" with { type: "text" };
import streamingDiffSource from "../../../ovens/streaming-diff/streaming-diff.oven" with { type: "text" };
import { FixtureFlame } from "./fixture-flame";
import { glyphFixture } from "./glyph-fixture";
import { StructuralOvenViewport } from "../oven-runtime/layout/structural-viewport";
import { TerminalOvenViewport } from "../oven-runtime/components/terminal-oven-viewport";
import { TerminalList } from "../oven-runtime/components/list-components";
import { TerminalStreamingFeedList } from "../oven-runtime/components/streaming-diff-components";
import { ControlsSurface } from "../oven-runtime/controls/controls-surface";
import { controlsAction, controlsFixture, controlsInitialState } from "../oven-runtime/controls/controls-fixture";
import { listFixture, listFixtureStates, listPreviewRows, type ListFixtureState } from "./list-fixture";
import { statusFixtureCheckpoints, statusFixtureStates } from "./status-fixture";
import { visualParityFixture } from "./visual-parity-fixture";
import { streamingDiffFixture } from "./streaming-diff-fixture";
import { initTerminalRuntime, reduceTerminalRuntime } from "../oven-runtime/state-runtime";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "../oven-runtime/components/terminal-capabilities";
import { admitTerminalOven, type JsonValue, type TerminalOvenIR } from "../oven-runtime/terminal-contract";

type Clock = Readonly<{ now(): number; setInterval(fn: () => void, delayMs: number): unknown; clearInterval(handle: unknown): void }>;
type FixtureId = "flame" | "structural" | "progress" | "status" | "lists" | "controls" | "visual-parity" | "streaming-diff" | "streaming-feeds";
type Mode = "wide" | "narrow";
const catalogFixtures: ReadonlyArray<Readonly<{ id: FixtureId; label: string; detail: string; checkpoints: readonly string[] }>> = [
  { id: "flame", label: "Glyph flame", detail: "glyphcss animated fire", checkpoints: glyphFixture.states.map((state) => state.checkpoint) },
  { id: "structural", label: "Structural layout", detail: "compiled layout projection", checkpoints: ["initial", "focused"] },
  { id: "progress", label: "Progress components", detail: "KPI strip and glyph metrics", checkpoints: ["ready", "complete"] },
  { id: "status", label: "Heading and status", detail: "reserved activity and empty-state surface", checkpoints: statusFixtureCheckpoints },
  { id: "lists", label: listFixture.title, detail: listFixture.detail, checkpoints: listFixtureStates },
  { id: "controls", label: controlsFixture.title, detail: controlsFixture.detail, checkpoints: controlsFixture.checkpoints },
  { id: "visual-parity", label: visualParityFixture.title, detail: visualParityFixture.detail, checkpoints: visualParityFixture.checkpoints },
  { id: "streaming-diff", label: "Streaming Diff", detail: "shared feed, card, and file-hunk fixture", checkpoints: streamingDiffFixture.checkpoints },
  { id: "streaming-feeds", label: "Streaming Diff feeds", detail: "landing feed metadata surface", checkpoints: ["normal", "loading", "error", "empty"] },
];
const progressPayloads = [
  { percent: 57, done: 4, total: 7, burns: [{ result: "pass" }, { result: "worsened" }, { result: "blocked" }], metric: { total: 8, failed: 2 }, required: "ready" },
  { percent: 100, done: 7, total: 7, burns: [{ result: "pass" }, { result: "pass" }, { result: "pass" }], metric: { total: 8, failed: 0 }, required: "complete" },
] as const satisfies readonly JsonValue[];

function compile(source: string, file: string): TerminalOvenIR {
  const result = compileOven(source, { file });
  if (!result.ok) throw new Error(result.diagnostics.map((entry: { message: string }) => entry.message).join("\n"));
  return result.ir as TerminalOvenIR;
}
const structuralOven = compile(structuralSource, "tui/src/catalog/structural-fixture.oven");
const progressOven = compile(progressSource, "tui/src/catalog/progress-fixture.oven");
const statusOven = compile(statusSource, "tui/src/catalog/status-fixture.oven");
const statusEmptyOven = compile(statusEmptySource, "tui/src/catalog/status-empty-fixture.oven");
const visualParityOven = compile(visualParitySource, "ovens/visual-parity/visual-parity.oven");
const streamingDiffOven = compile(streamingDiffSource, "ovens/streaming-diff/streaming-diff.oven");
const systemClock: Clock = { now: () => Date.now(), setInterval: (fn, delay) => setInterval(fn, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

export function CatalogApp({ shutdown, clock = systemClock }: { shutdown(): void; clock?: Clock }) {
  const [page, setPage] = useState<"catalog" | "preview">("catalog");
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("wide");
  const [checkpoint, setCheckpoint] = useState(0);
  const [reload, setReload] = useState(0);
  const [listIndex, setListIndex] = useState(4);
  const [listExpanded, setListExpanded] = useState(false);
  const [controlsState, setControlsState] = useState(controlsInitialState);
  const [visualState, setVisualState] = useState(() => initTerminalRuntime(visualParityOven, visualParityFixture.payload));
  const [streamingExpanded, setStreamingExpanded] = useState(false);
  const fixture = catalogFixtures[selected]!;
  const previewWidth = mode === "wide" ? 72 : 36;
  const previewHeight = mode === "wide" ? 16 : 14;
  const stateName = fixture.checkpoints[checkpoint % fixture.checkpoints.length]!;
  const progressResult = useMemo(() => admitTerminalOven(progressOven, { status: "ready", payload: progressPayloads[checkpoint % progressPayloads.length]! }, { viewport: { width: previewWidth, height: previewHeight } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [checkpoint, previewHeight, previewWidth, reload]);
  const statusState = statusFixtureStates[stateName as keyof typeof statusFixtureStates] ?? statusFixtureStates.normal;
  const statusResult = useMemo(() => admitTerminalOven(statusState.empty ? statusEmptyOven : statusOven, { status: "ready", payload: statusState.payload }, { viewport: { width: previewWidth, height: previewHeight } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, reload, statusState]);
  const visualResult = useMemo(() => admitTerminalOven(visualParityOven, { status: "ready", payload: visualParityFixture.payload }, { viewport: { width: previewWidth, height: previewHeight }, controls: visualState.controls }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, visualState]);
  const streamingResult = useMemo(() => admitTerminalOven(streamingDiffOven, { status: "ready", payload: streamingDiffFixture.payload }, { viewport: { width: previewWidth, height: previewHeight }, expandedKeys: streamingExpanded ? ["streaming-diff:first-file"] : [] }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, streamingExpanded]);
  const listState = stateName as ListFixtureState;
  const listRow = listFixture.rows[Math.max(0, Math.min(listIndex, listFixture.rows.length - 1))]!;

  const move = (amount: number) => setSelected((value) => (value + amount + catalogFixtures.length) % catalogFixtures.length);
  const nextCheckpoint = () => setCheckpoint((value) => (value + 1) % fixture.checkpoints.length);
  useKeyboard((key) => {
    const pressed = key.name ?? key.sequence;
    if (pressed === "escape") { if (page === "preview") setPage("catalog"); else shutdown(); return; }
    if (pressed === "q") { if (page === "preview") setPage("catalog"); return; }
    if (page === "catalog") {
      if (pressed === "up") move(-1);
      else if (pressed === "down") move(1);
      else if (pressed === "return" || pressed === "enter") { setCheckpoint(0); setListIndex(4); setListExpanded(false); setStreamingExpanded(false); setControlsState(controlsInitialState()); setPage("preview"); }
      return;
    }
    if (fixture.id === "lists") {
      if (pressed === "up") setListIndex((value) => Math.max(0, value - 1));
      else if (pressed === "down") setListIndex((value) => Math.min(listFixture.rows.length - 1, value + 1));
      else if (pressed === "return" || pressed === "enter") setListExpanded((value) => !value);
      else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
      else if (pressed === "r") setReload((value) => value + 1);
      return;
    }
    if (fixture.id === "controls") {
      if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
      else setControlsState((value) => controlsAction(value, pressed));
      return;
    }
    if (fixture.id === "visual-parity") {
      if (pressed === "left" || pressed === "right") setVisualState((state) => {
        const values = visualParityFixture.payload.domains, current = Math.max(0, values.indexOf(String(state.controls["domain-select"] ?? values[0]) as typeof values[number])), next = values[(current + (pressed === "right" ? 1 : -1) + values.length) % values.length]!;
        return reduceTerminalRuntime(state, { type: "domainSelected", id: "domain-select", value: next }, visualParityOven);
      });
      else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
      return;
    }
    if (fixture.id === "streaming-diff") { if (pressed === "return" || pressed === "enter") setStreamingExpanded((value) => !value); else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide"); return; }
    if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
    else if (pressed === "left" || pressed === "right") nextCheckpoint();
    else if (pressed === "c" || pressed === "s" || pressed === "tab") nextCheckpoint();
    else if (pressed === "r") setReload((value) => value + 1);
  });

  if (page === "catalog") return <CatalogList fixture={fixture} selected={selected} onSelected={setSelected} />;
  return <box width="100%" height="100%" flexDirection="column" backgroundColor="#151719" paddingLeft={2} paddingRight={2}>
    <CatalogHeader title={fixture.label} right={`${mode} · ${stateName} · r${reload}`} />
    <box flexGrow={1} overflow="hidden" paddingTop={1} paddingBottom={1}>
      <box key={`${fixture.id}-${reload}`} width={previewWidth} height={previewHeight} overflow="hidden" border={mode === "wide" ? ["left"] : undefined} borderColor="#3a3a40" paddingLeft={mode === "wide" ? 1 : 0}>
        {fixture.id === "flame" ? <FixtureFlame reducedMotion={stateName.startsWith("reduced")} clock={clock} /> : null}
        {fixture.id === "structural" ? <StructuralOvenViewport nodes={structuralOven.root} viewport={{ width: previewWidth - (mode === "wide" ? 1 : 0), height: previewHeight }} focusedPath={stateName === "focused" ? "root/1/2" : undefined} footer="" /> : null}
        {fixture.id === "progress" ? <TerminalOvenViewport result={progressResult} footer="" /> : null}
        {fixture.id === "status" ? <TerminalOvenViewport result={statusResult} footer="" /> : null}
        {fixture.id === "lists" ? <TerminalList model={{ ...listPreviewRows(previewWidth - (mode === "wide" ? 1 : 0), listState), selectedId: listRow.id, expandedId: listExpanded ? listRow.id : undefined, columns: listFixture.columns, height: previewHeight }} /> : null}
        {fixture.id === "controls" ? <ControlsSurface state={controlsState} showFooter={false} /> : null}
        {fixture.id === "visual-parity" ? <TerminalOvenViewport result={visualResult} footer="" /> : null}
        {fixture.id === "streaming-diff" ? <TerminalOvenViewport result={streamingResult} footer="" /> : null}
        {fixture.id === "streaming-feeds" ? <TerminalStreamingFeedList payload={{ ...streamingDiffFixture.payload, showRepository: true }} width={previewWidth} height={previewHeight} /> : null}
      </box>
    </box>
    <CatalogFooter text={fixture.id === "streaming-diff" ? "enter:expand · v:view · q:back" : fixture.id === "visual-parity" ? "←/→:domain · v:view · q:back" : fixture.id === "lists" ? "↑/↓:row · enter:expand · v:view · q:back" : fixture.id === "controls" ? "tab:focus · enter:toggle · v:view · q:back" : "v:view · c:state · r:reload · q:back"} />
  </box>;
}

function CatalogList({ fixture, selected, onSelected }: { fixture: (typeof catalogFixtures)[number]; selected: number; onSelected(value: number): void }) {
  return <box width="100%" height="100%" flexDirection="column" backgroundColor="#151719" paddingLeft={2} paddingRight={2}>
    <CatalogHeader title="Terminal catalog" right="paired review" />
    <box flexGrow={1} flexDirection="column" overflow="hidden" paddingTop={1}>
      <text fg="#a8a8a8">Choose a reusable terminal fixture to inspect.</text>
      <box height={1} />
      {catalogFixtures.map((entry, index) => <box key={entry.id} height={1} flexDirection="row" backgroundColor={index === selected ? "#282a2e" : "transparent"} paddingLeft={1} onMouseDown={() => onSelected(index)}>
        <text fg={index === selected ? "#5aa2ff" : "#e8e8e8"}>{index === selected ? "› " : "  "}{entry.label}</text><text fg="#84888f">  {entry.detail}</text>
      </box>)}
      <box height={1} /><text fg="#686868">Selected: {fixture.label}</text>
    </box>
    <CatalogFooter text="↑/↓:choose · enter:inspect · esc:exit" />
  </box>;
}

function CatalogHeader({ title, right }: { title: string; right: string }) {
  return <box height={2} flexDirection="row" justifyContent="space-between" border={["bottom"]} borderColor="#3a3a40"><text fg="#e8e8e8">⟁  Burnlist · {title}</text><text fg="#a8a8a8">{right}</text></box>;
}
function CatalogFooter({ text }: { text: string }) {
  return <box height={2} flexDirection="row" border={["top"]} borderColor="#3a3a40" alignItems="center"><text fg="#84888f">{text}</text></box>;
}
