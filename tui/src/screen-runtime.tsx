import type { GlyphNode, GlyphScreen } from "../../src/glyph/glyph-compile.mjs";
import { CatalogOvenDetail, CatalogOvenRuntime } from "./catalog-view";
import { BrandHeader, DetailSummary } from "./detail-view";
import { DetailItemList } from "./detail-item-list";
import { ItemDetail } from "./item-view";
import { BurnlistList, LandingSectionHeading, OvenList } from "./landing-view";
import { genericOvens } from "./oven-fit";
import { officialOvenFixture } from "./catalog/official-oven-fixtures";
import { prepareTerminalComponentResult, TerminalOvenViewport } from "./oven-runtime/components";
import { TerminalStreamingFeedList } from "./oven-runtime/components/streaming-diff-components";
import { TerminalLoopProgress, terminalLoopProgressRows } from "./oven-runtime/components/loop-components";
import type { StreamingDiffNavigation } from "./oven-runtime/streaming-diff-navigation";
import type { TerminalRenderResult } from "./oven-runtime/terminal-contract";
import { fitText } from "./theme";
import { useTerminalPalette, type TerminalPalette } from "./terminal-accessibility";
import { TerminalChromeProvider, type TerminalChrome, useTerminalChrome } from "./terminal-chrome";
import { useCoalescedTerminalDimensions } from "./use-coalesced-terminal-dimensions";
import type {
  BurnlistSummary,
  DetailItem,
  LandingSnapshot,
  OvenDataSnapshot,
  OvenPackageDetail,
  OvenSummary,
  ProgressSnapshot,
} from "./types";
import type { JsonValue, TerminalNode } from "./oven-runtime/terminal-contract";
import type { StreamStatus } from "./event-stream";

export interface ScreenRuntimeProps {
  screen: GlyphScreen;
  landing: LandingSnapshot;
  progress: ProgressSnapshot | null;
  selectedBurnlist: BurnlistSummary | null;
  activeOven: OvenSummary | null;
  ovenDetail: OvenPackageDetail | null;
  ovenLenses: OvenSummary[];
  ovenData: OvenDataSnapshot | null;
  selectedItem: DetailItem | null;
  items: DetailItem[];
  itemIndex: number;
  itemDetailScroll?: number;
  domainIndex: number;
  focusId: string;
  selections: Record<string, number>;
  streamStatus: StreamStatus;
  notice?: { message: string; tone: "error" | "info" } | null;
  ovenRuntime?: TerminalRenderResult | null;
  streamingNavigation?: StreamingDiffNavigation | null;
}

function listRows(height: number): number {
  return Math.max(2, Math.floor((height - 11) / 2));
}

const DETAIL_LOOP_NODE: TerminalNode = {
  kind: "loop-progress",
  attributes: { source: "/raw" },
  bindings: {},
  children: [],
  source: { offset: 0, line: 1, column: 1 },
};

function DetailSplit({ node, props, width, height, chrome }: {
  node: GlyphNode;
  props: ScreenRuntimeProps;
  width: number;
  height: number;
  chrome: TerminalChrome;
}) {
  const palette = useTerminalPalette();
  const collapsed = width < Number(node.attributes.collapseAt ?? 96);
  const summaryWidth = Number(node.attributes.summaryWidth ?? 52);
  const contentHeight = Math.max(1, height - 4);
  const checklist = props.progress !== null && props.progress !== undefined;
  const sidebarWidth = checklist ? summaryWidth : Math.min(38, summaryWidth);
  const sidebarHeight = collapsed && checklist ? Math.max(12, Math.floor(contentHeight * 0.58)) : collapsed ? 6 : contentHeight;
  const ovenWidth = collapsed ? width : Math.max(1, width - sidebarWidth);
  const ovenContentWidth = Math.max(1, ovenWidth - 4);
  const ovenHeight = collapsed ? Math.max(1, contentHeight - sidebarHeight) : contentHeight;
  const runtimePayload = props.ovenRuntime?.payload;
  const runtimeRecord = runtimePayload && typeof runtimePayload === "object" && !Array.isArray(runtimePayload)
    ? runtimePayload as Record<string, JsonValue>
    : {};
  const runtimeRaw = runtimeRecord.raw && typeof runtimeRecord.raw === "object" && !Array.isArray(runtimeRecord.raw)
    ? runtimeRecord.raw as Record<string, JsonValue>
    : props.progress as unknown as Record<string, JsonValue> | null;
  const selectedPayload = checklist && props.selectedItem && runtimeRaw
    ? { ...runtimeRecord, raw: { ...runtimeRaw, selectedItemId: props.selectedItem.id } } as JsonValue
    : runtimePayload;
  const runtime = props.ovenRuntime ? prepareTerminalComponentResult({
    ...props.ovenRuntime,
    ...(selectedPayload !== undefined ? { payload: selectedPayload } : {}),
    state: { ...props.ovenRuntime.state, viewport: { width: ovenContentWidth, height: ovenHeight } },
  }) : null;
  const listHeight = Math.max(3, sidebarHeight - 6);
  const inspectorWidth = Math.max(1, ovenWidth - 4);
  const splitInspector = inspectorWidth >= 96 && ovenHeight >= 14;
  const splitItemWidth = splitInspector ? Math.max(32, Math.floor(inspectorWidth * 0.36)) : inspectorWidth;
  const splitLoopWidth = splitInspector ? Math.max(1, inspectorWidth - splitItemWidth - 1) : inspectorWidth;
  const loopRenderWidth = splitInspector ? Math.max(1, splitLoopWidth - 2) : splitLoopWidth;
  const measuredLoopHeight = selectedPayload
    ? terminalLoopProgressRows(DETAIL_LOOP_NODE, selectedPayload, loopRenderWidth, splitInspector)
    : 5;
  const loopHeight = Math.max(5, Math.min(measuredLoopHeight, Math.max(5, ovenHeight - 4)));
  const topHeight = splitInspector ? loopHeight : 0;
  const remainingHeight = Math.max(1, ovenHeight - (splitInspector ? topHeight + 1 : loopHeight + 1));
  return <box height={contentHeight} maxHeight={contentHeight} flexGrow={0} flexShrink={1} minHeight={0} overflow="hidden" flexDirection={collapsed ? "column" : "row"}>
    <box
      width={collapsed ? "100%" : sidebarWidth}
      height={collapsed ? sidebarHeight : "100%"}
      flexShrink={0}
      minHeight={0}
      overflow="hidden"
      border={collapsed ? ["bottom"] : ["right"]}
      borderColor={chrome.line}
      flexDirection="column"
    >
      <box height={6}>
        <DetailSummary
          burnlist={props.selectedBurnlist}
          progress={props.progress}
          compact
          width={collapsed ? width : sidebarWidth}
        />
      </box>
      {checklist ? <DetailItemList
        items={props.items}
        selected={props.itemIndex}
        width={collapsed ? width : sidebarWidth}
        height={listHeight}
      /> : null}
    </box>
    <box flexGrow={1} minWidth={0} minHeight={0} overflow="hidden" paddingLeft={checklist ? 0 : 2} paddingRight={checklist ? 0 : 2}>
      {checklist && selectedPayload ? <box height={ovenHeight} paddingLeft={2} paddingRight={2} flexDirection="column" overflow="hidden">
        {splitInspector ? <box width={inspectorWidth} height={topHeight} flexDirection="row" overflow="hidden">
          <ItemDetail item={props.selectedItem} width={splitItemWidth} height={topHeight} section="header" />
          <box width={1} height={topHeight} border={["right"]} borderColor={chrome.faintLine} />
          <box width={splitLoopWidth} height={topHeight} paddingLeft={2} overflow="hidden">
            <TerminalLoopProgress node={DETAIL_LOOP_NODE} payload={selectedPayload} width={loopRenderWidth} height={topHeight} topologyOnly />
          </box>
        </box> : <TerminalLoopProgress node={DETAIL_LOOP_NODE} payload={selectedPayload} width={inspectorWidth} height={loopHeight} />}
        <box height={1} border={["top"]} borderColor={chrome.faintLine} />
        <ItemDetail
          item={props.selectedItem}
          width={inspectorWidth}
          height={remainingHeight}
          section={splitInspector ? "content" : "all"}
        />
      </box> : checklist ? <ItemDetail
        item={props.selectedItem}
        width={collapsed ? width : width - sidebarWidth}
        height={collapsed ? Math.max(1, contentHeight - sidebarHeight) : contentHeight}
      /> : runtime ? <TerminalOvenViewport result={runtime} footer="" /> : <box paddingTop={1} overflow="hidden"><text fg={palette.dim}>{fitText("This Burnlist has no admitted Oven payload.", ovenContentWidth).trimEnd()}</text></box>}
    </box>
  </box>;
}
function StreamingSession({ props, width, height }: { props: ScreenRuntimeProps; width: number; height: number }) {
  const palette = useTerminalPalette();
  const navigation = props.streamingNavigation!, error = navigation.sessionError, available = Math.max(3, height - 1 - (error ? 1 : 0));
  const runtime = props.ovenRuntime ? prepareTerminalComponentResult({ ...props.ovenRuntime, state: { ...props.ovenRuntime.state, viewport: { width: Math.max(1, width - 6), height: available } } }) : null;
  return <box height={height} paddingLeft={3} paddingRight={3} paddingTop={1} overflow="hidden" flexDirection="column">{error ? <box height={1} overflow="hidden"><text fg={palette.amber}>{fitText(error, Math.max(1, width - 6))}</text></box> : null}{runtime ? <TerminalOvenViewport result={runtime} footer="←/→:card · ↑/↓:file · enter:expand · r:refresh · q:feeds" streaming={{ selectedCard: navigation.selectedCard, selectedFile: navigation.selectedFile, expandedKey: navigation.expandedFile }} /> : <text>Loading session…</text>}</box>;
}

function renderNode(node: GlyphNode, props: ScreenRuntimeProps, width: number, height: number, chrome: TerminalChrome, palette: TerminalPalette): React.ReactNode {
  const key = `${node.kind}:${node.source.offset}`;
  const rows = listRows(height);
  const catalog = genericOvens(props.landing.ovens);
  switch (node.kind) {
    case "brand-header": {
      const center = props.screen.id === "item" ? props.selectedItem?.title
        : props.screen.id === "oven" ? props.ovenDetail?.name ?? props.activeOven?.name
          : props.screen.id === "burnlist" ? props.selectedBurnlist?.title : null;
      const compact = props.screen.id === "home";
      const subtitle = props.screen.id === "home"
        ? `${props.landing.burnlists.length} Burnlists · ${props.landing.projects.length} ${props.landing.projects.length === 1 ? "project" : "projects"} · ${props.streamStatus === "live" ? "LIVE" : "SYNC"}`
        : String(node.attributes.subtitle);
      return <BrandHeader key={key} center={center} subtitle={subtitle} compact={compact} activity={props.notice} />;
    }
    case "section-heading":
      return <LandingSectionHeading
        key={key}
        title={String(node.attributes.title)}
        source={String(node.attributes.source) as "burnlists" | "ovens"}
        landing={node.attributes.source === "ovens" ? { ...props.landing, ovens: catalog } : props.landing}
      />;
    case "burnlist-list":
      return <BurnlistList
        key={key}
        landing={props.landing}
        selected={props.selections.burnlists ?? 0}
        focused={props.focusId === "burnlists"}
        maxRows={Math.max(2, height - 5)}
        terminalWidth={width}
        empty={String(node.attributes.empty ?? "No Burnlists")}
      />;
    case "oven-list":
      return <OvenList
        key={key}
        entries={catalog}
        selected={props.selections.ovens ?? 0}
        focused={props.focusId === "ovens"}
        maxRows={rows}
        terminalWidth={width}
        empty={String(node.attributes.empty ?? "No Ovens")}
      />;
    case "detail-split":
      return <DetailSplit key={key} node={node} props={props} width={width} height={height} chrome={chrome} />;
    case "oven-detail":
      if (props.streamingNavigation) return props.streamingNavigation.page === "feeds" ? <box key={key} height={height - 4} paddingLeft={3} paddingRight={3} paddingTop={1} overflow="hidden"><TerminalStreamingFeedList payload={{ feeds: props.streamingNavigation.feeds, ...(props.streamingNavigation.feedStatus === "loading" ? { loading: true } : props.streamingNavigation.feedStatus === "error" ? { error: props.streamingNavigation.sessionError } : {}) }} selectedFeed={props.streamingNavigation.selectedFeed} width={Math.max(1, width - 6)} height={height - 5} /></box> : <StreamingSession key={key} props={props} width={width} height={height - 4} />;
      if (props.ovenRuntime) return <CatalogOvenRuntime key={key} summary={props.activeOven} detail={props.ovenDetail} result={props.ovenRuntime} height={height - 4} width={width} footer={officialOvenFixture(props.activeOven?.id)?.footer ?? "q:back"} />;
      return <CatalogOvenDetail key={key} summary={props.activeOven} detail={props.ovenDetail} height={height - 4} width={width} />;
    case "item-detail":
      return <ItemDetail key={key} item={props.selectedItem} width={width} height={Math.max(1, height - 4)} scrollOffset={props.itemDetailScroll} />;
    case "footer":
      {
        const managedChecklist = props.progress !== null && props.progress !== undefined;
        const ovenHints = props.screen.id === "burnlist" && !managedChecklist
          ? officialOvenFixture(props.activeOven?.id)?.footer ?? "arrows/enter:interact · x/f/s/m:controls · q/esc:back"
          : String(node.attributes.hints);
      return <box key={key} height={2} flexShrink={0} zIndex={10} flexDirection="row" justifyContent="flex-start" border={["top"]} borderColor={chrome.line} paddingLeft={3} alignItems="center">
        <text fg={palette.dim}>{fitText(ovenHints, Math.max(1, width - 6)).trimEnd()}</text>
      </box>;
      }
    default:
      return null;
  }
}

function ScreenSurface(props: ScreenRuntimeProps) {
  const { width, height } = useCoalescedTerminalDimensions();
  const chrome = useTerminalChrome();
  const palette = useTerminalPalette();
  return <box width="100%" height="100%" flexDirection="column" overflow="hidden" backgroundColor={chrome.background}>
    {props.screen.root.children.map((node) => renderNode(node, props, width, height, chrome, palette))}
  </box>;
}

export function ScreenRuntime(props: ScreenRuntimeProps) {
  return <TerminalChromeProvider><ScreenSurface {...props} /></TerminalChromeProvider>;
}
