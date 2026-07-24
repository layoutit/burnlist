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
import differentialSource from "../../../ovens/differential-testing/differential-testing.oven" with { type: "text" };
import checklistSource from "../../../ovens/checklist/checklist.oven" with { type: "text" };
import modelLabSource from "../../../ovens/model-lab/model-lab.oven" with { type: "text" };
import { FixtureFlame } from "./fixture-flame";
import { FixtureChiminea } from "./fixture-chiminea";
import { chimineaFixture } from "./chiminea-fixture";
import { glyphFixture } from "./glyph-fixture";
import { StructuralOvenViewport } from "../oven-runtime/layout/structural-viewport";
import { TerminalOvenViewport } from "../oven-runtime/components/terminal-oven-viewport";
import { componentRootPath } from "../oven-runtime/components/component-layout";
import { TerminalList } from "../oven-runtime/components/list-components";
import { TerminalStreamingFeedList } from "../oven-runtime/components/streaming-diff-components";
import { ControlsSurface } from "../oven-runtime/controls/controls-surface";
import { controlsAction, controlsFixture, controlsInitialState } from "../oven-runtime/controls/controls-fixture";
import { listFixture, listFixtureStates, listPreviewRows, type ListFixtureState } from "./list-fixture";
import { statusFixtureCheckpoints, statusFixtureStates } from "./status-fixture";
import { visualParityFixture } from "./visual-parity-fixture";
import { streamingDiffFixture, streamingFeedFixture } from "./streaming-diff-fixture";
import { differentialFixture } from "./differential-fixture";
import { checklistFixture } from "./checklist-fixture";
import { modelLabFixture } from "./model-lab-fixture";
import { applyVerifiedModelLabFrame, type ModelLabClient } from "./model-lab-controller";
import { initTerminalRuntime, reduceTerminalRuntime } from "../oven-runtime/state-runtime";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "../oven-runtime/components/terminal-capabilities";
import { admitTerminalOven, type JsonValue, type TerminalOvenIR } from "../oven-runtime/terminal-contract";
import { initStreamingDiffNavigation, reduceStreamingDiffNavigation } from "../oven-runtime/streaming-diff-navigation";
import { useTerminalPalette } from "../terminal-accessibility";
import { useTerminalChrome } from "../terminal-chrome";

type Clock = Readonly<{ now(): number; setInterval(fn: () => void, delayMs: number): unknown; clearInterval(handle: unknown): void }>;
type FixtureId = "flame" | "structural" | "progress" | "status" | "lists" | "controls" | "visual-parity" | "streaming-diff" | "streaming-feeds" | "differential-testing" | "checklist" | "model-lab" | "chiminea";
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
  { id: "differential-testing", label: "Differential Testing", detail: "compiled KPI, chart, log, and field drill-down", checkpoints: differentialFixture.checkpoints },
  { id: "checklist", label: "Checklist", detail: "shared progress, ledger, and event detail", checkpoints: checklistFixture.checkpoints },
  { id: "model-lab", label: "Model Lab", detail: "producer readiness and retained frame evidence", checkpoints: modelLabFixture.checkpoints },
  { id: "chiminea", label: chimineaFixture.title, detail: chimineaFixture.detail, checkpoints: chimineaFixture.checkpoints },
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
const differentialOven = compile(differentialSource, "ovens/differential-testing/differential-testing.oven");
const checklistOven = compile(checklistSource, "ovens/checklist/checklist.oven");
const modelLabOven = compile(modelLabSource, "ovens/model-lab/model-lab.oven");
const systemClock: Clock = { now: () => Date.now(), setInterval: (fn, delay) => setInterval(fn, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

export function CatalogApp({ shutdown, clock = systemClock, modelLabClient }: { shutdown(): void; clock?: Clock; modelLabClient?: ModelLabClient }) {
  const chrome = useTerminalChrome();
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
  const [streamingNavigation, setStreamingNavigation] = useState(() => initStreamingDiffNavigation("streaming-feeds"));
  const [differentialState, setDifferentialState] = useState(() => initTerminalRuntime(differentialOven, differentialFixture.payload));
  const [checklistState, setChecklistState] = useState(() => initTerminalRuntime(checklistOven, checklistFixture.active));
  const [modelLabState, setModelLabState] = useState(() => initTerminalRuntime(modelLabOven, modelLabFixture.ready));
  const [modelLabPayload, setModelLabPayload] = useState(modelLabFixture.ready);
  const fixture = catalogFixtures[selected]!;
  const previewWidth = mode === "wide" ? 72 : 36;
  const previewHeight = mode === "wide" ? 16 : 14;
  const stateName = fixture.checkpoints[checkpoint % fixture.checkpoints.length]!;
  const progressResult = useMemo(() => admitTerminalOven(progressOven, { status: "ready", payload: progressPayloads[checkpoint % progressPayloads.length]! }, { viewport: { width: previewWidth, height: previewHeight } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [checkpoint, previewHeight, previewWidth, reload]);
  const statusState = statusFixtureStates[stateName as keyof typeof statusFixtureStates] ?? statusFixtureStates.normal;
  const statusResult = useMemo(() => admitTerminalOven(statusState.empty ? statusEmptyOven : statusOven, { status: "ready", payload: statusState.payload }, { viewport: { width: previewWidth, height: previewHeight } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, reload, statusState]);
  const visualResult = useMemo(() => admitTerminalOven(visualParityOven, { status: "ready", payload: visualParityFixture.payload }, { viewport: { width: previewWidth, height: previewHeight }, controls: visualState.controls }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, visualState]);
  const streamingResult = useMemo(() => admitTerminalOven(streamingDiffOven, { status: "ready", payload: streamingDiffFixture.payload }, { viewport: { width: previewWidth, height: previewHeight }, expandedKeys: streamingExpanded ? ["streaming-diff:first-file"] : [] }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, streamingExpanded]);
  const streamingSessionPayload = useMemo(() => streamingNavigation.session ? { ...streamingDiffFixture.payload, identity: { ...streamingDiffFixture.payload.identity, session: streamingNavigation.session.identity.session } } : streamingDiffFixture.payload, [streamingNavigation.session]);
  const streamingSessionResult = useMemo(() => admitTerminalOven(streamingDiffOven, { status: "ready", payload: streamingSessionPayload }, { viewport: { width: previewWidth, height: previewHeight }, expandedKeys: streamingNavigation.expandedFile ? [streamingNavigation.expandedFile] : [] }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [previewHeight, previewWidth, streamingNavigation.expandedFile, streamingSessionPayload]);
  const differentialPayload = stateName === "empty" ? differentialFixture.empty : stateName === "failure" ? differentialFixture.failure : differentialFixture.payload;
  const differentialFields = "fields" in differentialPayload && Array.isArray(differentialPayload.fields) ? differentialPayload.fields : [];
  const differentialKey = differentialFields.find((field: { id: string }) => differentialState.expandedKeys.includes(`field-view:${field.id}`))?.id;
  const differentialResult = useMemo(() => admitTerminalOven(differentialOven, { status: "ready", payload: differentialPayload }, { viewport: { width: previewWidth, height: previewHeight }, controls: differentialState.controls, expandedKeys: differentialState.expandedKeys }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [differentialPayload, differentialState, previewHeight, previewWidth]);
  const checklistPayload = stateName === "completed" ? checklistFixture.completed : stateName === "long-list" ? checklistFixture.longList : checklistFixture.active;
  const checklistEventPath = componentRootPath(checklistOven.root, previewWidth, "checklist-event-cards", checklistPayload, checklistState.controls);
  const checklistFocusIds = checklistEventPath && checklistState.focusId === checklistEventPath ? [checklistEventPath] : [];
  const checklistResult = useMemo(() => admitTerminalOven(checklistOven, { status: "ready", payload: checklistPayload }, { viewport: { width: previewWidth, height: previewHeight }, controls: checklistState.controls, expandedKeys: checklistState.expandedKeys, ...(checklistState.focusId ? { focusId: checklistState.focusId } : {}) }, checklistFocusIds, TERMINAL_IMPLEMENTED_CAPABILITIES), [checklistFocusIds, checklistPayload, checklistState, previewHeight, previewWidth]);
  const displayedModelLabPayload = stateName === "unavailable" ? modelLabFixture.unavailable : stateName === "failure" ? modelLabFixture.failure : modelLabPayload;
  const modelLabResult = useMemo(() => admitTerminalOven(modelLabOven, { status: "ready", payload: displayedModelLabPayload }, { viewport: { width: previewWidth, height: previewHeight } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES), [displayedModelLabPayload, previewHeight, previewWidth]);
  const listState = stateName as ListFixtureState;
  const listRow = listFixture.rows[Math.max(0, Math.min(listIndex, listFixture.rows.length - 1))]!;

  const move = (amount: number) => setSelected((value) => (value + amount + catalogFixtures.length) % catalogFixtures.length);
  const nextCheckpoint = () => setCheckpoint((value) => (value + 1) % fixture.checkpoints.length);
  useKeyboard((key) => {
    const pressed = key.name ?? key.sequence;
    if (pressed === "escape") { if (page === "preview") setPage("catalog"); else shutdown(); return; }
    if (pressed === "q") { if (fixture.id === "streaming-feeds" && streamingNavigation.page === "session") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "back" })); else if (page === "preview") setPage("catalog"); return; }
    if (page === "catalog") {
      if (pressed === "up") move(-1);
      else if (pressed === "down") move(1);
      else if (pressed === "return" || pressed === "enter") { setCheckpoint(0); setListIndex(4); setListExpanded(false); setStreamingExpanded(false); setStreamingNavigation(reduceStreamingDiffNavigation(initStreamingDiffNavigation("streaming-feeds"), { type: "feedsLoaded", feeds: streamingFeedFixture.feeds })); setDifferentialState(initTerminalRuntime(differentialOven, differentialFixture.payload)); setChecklistState(initTerminalRuntime(checklistOven, checklistFixture.active)); setModelLabState(initTerminalRuntime(modelLabOven, modelLabFixture.ready)); setModelLabPayload(modelLabFixture.ready); setControlsState(controlsInitialState()); setPage("preview"); }
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
        const values = visualParityFixture.payload.domains.map((domain: { id: string }) => domain.id), current = Math.max(0, values.indexOf(String(state.controls["domain-select"] ?? values[0]))), next = values[(current + (pressed === "right" ? 1 : -1) + values.length) % values.length]!;
        return reduceTerminalRuntime(state, { type: "domainSelected", id: "domain-select", value: next }, visualParityOven);
      });
      else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
      return;
    }
    if (fixture.id === "streaming-diff") { if (pressed === "return" || pressed === "enter") setStreamingExpanded((value) => !value); else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide"); return; }
    if (fixture.id === "streaming-feeds") {
      if (streamingNavigation.page === "feeds") {
        if (pressed === "up") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "feedMoved", direction: -1 }));
        else if (pressed === "down") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "feedMoved", direction: 1 }));
        else if (pressed === "return" || pressed === "enter") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "feedOpened" }));
        else if (pressed === "r") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "feedsLoaded", feeds: streamingFeedFixture.feeds }));
      } else if (pressed === "up") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "fileMoved", direction: -1, fileCount: streamingDiffFixture.payload.cards[0]?.files.length ?? 0 }));
      else if (pressed === "down") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "fileMoved", direction: 1, fileCount: streamingDiffFixture.payload.cards[0]?.files.length ?? 0 }));
      else if (pressed === "return" || pressed === "enter") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "fileToggled", key: "streaming-diff:first-file" }));
      else if (pressed === "r") setStreamingNavigation((state) => reduceStreamingDiffNavigation(state, { type: "refresh" }));
      else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
      return;
    }
    if (fixture.id === "differential-testing") { if (pressed === "return" || pressed === "enter") { const field = differentialKey ?? differentialFields[0]?.id; if (field) setDifferentialState((state) => reduceTerminalRuntime(state, { type: "toggleExpanded", key: `field-view:${field}` }, differentialOven)); } else if (pressed === "c") setDifferentialState((state) => reduceTerminalRuntime(state, { type: "modeSelected", id: "progress-mode", value: state.controls["progress-mode"] === "delta" ? "progress" : state.controls["progress-mode"] === "progress" ? "failed" : "delta" }, differentialOven)); else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide"); else if (pressed === "left" || pressed === "right") nextCheckpoint(); return; }
    if (fixture.id === "checklist") { if (pressed === "return" || pressed === "enter") setChecklistState((state) => { const expanded = state.expandedKeys.includes("checklist-event-cards:latest"), next = reduceTerminalRuntime(state, { type: "toggleExpanded", key: "checklist-event-cards:latest" }, checklistOven); return { ...next, ...(expanded || !checklistEventPath ? { focusId: undefined } : { focusId: checklistEventPath }) }; }); else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide"); else if (pressed === "left" || pressed === "right") nextCheckpoint(); return; }
    if (fixture.id === "model-lab") { if (pressed === "left" || pressed === "right") { const next = (modelLabPayload.terminal.frame.index + (pressed === "right" ? 1 : -1) + modelLabPayload.terminal.frame.count) % modelLabPayload.terminal.frame.count, client = modelLabClient; if (client) void client.select({ sessionId: modelLabPayload.terminal.sessionId, requestId: `catalog-frame-${next}`, frameIndex: next }).then((result) => { if (result.status === "ready" && result.frame) setModelLabPayload(applyVerifiedModelLabFrame(modelLabPayload, result.frame) as typeof modelLabPayload); }); } else if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide"); else if (pressed === "c") nextCheckpoint(); return; }
    if (pressed === "v") setMode((value) => value === "wide" ? "narrow" : "wide");
    else if (pressed === "left" || pressed === "right") nextCheckpoint();
    else if (pressed === "c" || pressed === "s" || pressed === "tab") nextCheckpoint();
    else if (pressed === "r") setReload((value) => value + 1);
  });

  if (page === "catalog") return <CatalogList fixture={fixture} selected={selected} onSelected={setSelected} />;
  return <box width="100%" height="100%" flexDirection="column" backgroundColor={chrome.background} paddingLeft={2} paddingRight={2}>
    <CatalogHeader title={fixture.label} right={`${mode} · ${stateName} · r${reload}`} />
    <box flexGrow={1} overflow="hidden" paddingTop={1} paddingBottom={1}>
      <box key={`${fixture.id}-${reload}`} width={previewWidth} height={previewHeight} overflow="hidden" border={mode === "wide" ? ["left"] : undefined} borderColor={chrome.line} paddingLeft={mode === "wide" ? 1 : 0}>
        {fixture.id === "flame" ? <FixtureFlame reducedMotion={stateName.startsWith("reduced")} clock={clock} /> : null}
        {fixture.id === "structural" ? <StructuralOvenViewport nodes={structuralOven.root} viewport={{ width: previewWidth - (mode === "wide" ? 1 : 0), height: previewHeight }} focusedPath={stateName === "focused" ? "root/1/2" : undefined} footer="" /> : null}
        {fixture.id === "progress" ? <TerminalOvenViewport result={progressResult} footer="" /> : null}
        {fixture.id === "status" ? <TerminalOvenViewport result={statusResult} footer="" /> : null}
        {fixture.id === "lists" ? <TerminalList model={{ ...listPreviewRows(previewWidth - (mode === "wide" ? 1 : 0), listState), selectedId: listRow.id, expandedId: listExpanded ? listRow.id : undefined, columns: listFixture.columns, height: previewHeight }} /> : null}
        {fixture.id === "controls" ? <ControlsSurface state={controlsState} showFooter={false} /> : null}
        {fixture.id === "visual-parity" ? <TerminalOvenViewport result={visualResult} footer="" /> : null}
        {fixture.id === "streaming-diff" ? <TerminalOvenViewport result={streamingResult} footer="" /> : null}
        {fixture.id === "streaming-feeds" && streamingNavigation.page === "feeds" ? <TerminalStreamingFeedList payload={{ ...streamingFeedFixture, ...(streamingNavigation.feedStatus === "loading" ? { loading: true } : streamingNavigation.feedStatus === "error" ? { error: streamingNavigation.sessionError } : {}) }} selectedFeed={streamingNavigation.selectedFeed} width={previewWidth} height={previewHeight} /> : null}
        {fixture.id === "streaming-feeds" && streamingNavigation.page === "session" ? <TerminalOvenViewport result={streamingSessionResult} footer="" /> : null}
        {fixture.id === "differential-testing" ? <TerminalOvenViewport result={differentialResult} footer="" /> : null}
        {fixture.id === "checklist" ? <TerminalOvenViewport result={checklistResult} footer="" /> : null}
        {fixture.id === "model-lab" ? <TerminalOvenViewport result={modelLabResult} footer="" /> : null}
        {fixture.id === "chiminea" ? <FixtureChiminea reducedMotion={stateName === "reduced-motion"} clock={clock} /> : null}
      </box>
    </box>
    <CatalogFooter text={fixture.id === "differential-testing" ? "↑/↓:field · c:chart · ←/→:state · enter:detail · v:view · q:back" : fixture.id === "checklist" ? "←/→:state · enter:latest detail · v:view · q:back" : fixture.id === "model-lab" ? modelLabClient ? "←/→:request frame · c:state · v:view · q:back" : "frame controller unavailable · c:state · v:view · q:back" : fixture.id === "streaming-diff" ? "enter:expand · v:view · q:back" : fixture.id === "streaming-feeds" ? streamingNavigation.page === "feeds" ? "↑/↓:feed · enter:open · r:refresh · q:back" : "↑/↓:file · enter:expand · r:refresh · q:feeds" : fixture.id === "visual-parity" ? "←/→:domain · v:view · q:back" : fixture.id === "lists" ? "↑/↓:row · enter:expand · v:view · q:back" : fixture.id === "controls" ? "tab:focus · enter:toggle · v:view · q:back" : "v:view · c:state · r:reload · q:back"} />
  </box>;
}

function CatalogList({ fixture, selected, onSelected }: { fixture: (typeof catalogFixtures)[number]; selected: number; onSelected(value: number): void }) {
  const palette = useTerminalPalette(), chrome = useTerminalChrome();
  return <box width="100%" height="100%" flexDirection="column" backgroundColor={chrome.background} paddingLeft={2} paddingRight={2}>
    <CatalogHeader title="Terminal catalog" right="paired review" />
    <box flexGrow={1} flexDirection="column" overflow="hidden" paddingTop={1}>
      <text fg={palette.muted}>Choose a reusable terminal fixture to inspect.</text>
      <box height={1} />
      {catalogFixtures.map((entry, index) => <box key={entry.id} height={1} flexDirection="row" backgroundColor={index === selected ? chrome.surface : chrome.background} paddingLeft={1} onMouseDown={() => onSelected(index)}>
        <text fg={index === selected ? palette.blue : palette.foreground}>{index === selected ? "› " : "  "}{entry.label}</text><text fg={palette.dim}>  {entry.detail}</text>
      </box>)}
      <box height={1} /><text fg={palette.dim}>Selected: {fixture.label}</text>
    </box>
    <CatalogFooter text="↑/↓:choose · enter:inspect · esc:exit" />
  </box>;
}

function CatalogHeader({ title, right }: { title: string; right: string }) {
  const palette = useTerminalPalette(), chrome = useTerminalChrome();
  return <box height={2} flexDirection="row" justifyContent="space-between" border={["bottom"]} borderColor={chrome.line}><text fg={palette.foreground}>⟁  Burnlist · {title}</text><text fg={palette.muted}>{right}</text></box>;
}
function CatalogFooter({ text }: { text: string }) {
  const palette = useTerminalPalette(), chrome = useTerminalChrome();
  return <box height={2} flexDirection="row" border={["top"]} borderColor={chrome.line} alignItems="center"><text fg={palette.dim}>{text}</text></box>;
}
