import { useTerminalDimensions } from "@opentui/react";
import type { GlyphNode, GlyphScreen } from "../../src/glyph/glyph-compile.mjs";
import { CatalogOvenDetail } from "./catalog-view";
import { BrandHeader, DetailSummary } from "./detail-view";
import { ItemDetail } from "./item-view";
import { BurnlistList, LandingSectionHeading, OvenList } from "./landing-view";
import { genericOvens } from "./oven-fit";
import { OvenPane } from "./oven-view";
import { prepareTerminalComponentResult, TerminalOvenViewport } from "./oven-runtime/components";
import { TerminalStreamingFeedList } from "./oven-runtime/components/streaming-diff-components";
import type { StreamingDiffNavigation } from "./oven-runtime/streaming-diff-navigation";
import type { TerminalRenderResult } from "./oven-runtime/terminal-contract";
import { fitText, palette } from "./theme";
import { TerminalChromeProvider, type TerminalChrome, useTerminalChrome } from "./terminal-chrome";
import type {
  BurnlistSummary,
  DetailItem,
  LandingSnapshot,
  OvenDataSnapshot,
  OvenPackageDetail,
  OvenSummary,
  ProgressSnapshot,
} from "./types";
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
  itemIndex: number;
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

function DetailSplit({ node, props, width, height, chrome }: {
  node: GlyphNode;
  props: ScreenRuntimeProps;
  width: number;
  height: number;
  chrome: TerminalChrome;
}) {
  const collapsed = width < Number(node.attributes.collapseAt ?? 96);
  const summary = node.children.find((child) => child.kind === "detail-summary");
  const summaryWidth = Number(node.attributes.summaryWidth ?? 52);
  const contentHeight = Math.max(1, height - 3);
  const sidebarHeight = collapsed ? Math.max(12, Math.floor(contentHeight * 0.58)) : contentHeight;
  const runtime = props.ovenRuntime ? prepareTerminalComponentResult({ ...props.ovenRuntime, state: { ...props.ovenRuntime.state, viewport: { width: collapsed ? width : summaryWidth, height: Math.max(1, sidebarHeight - 5) } } }) : null;
  return <box height={contentHeight} maxHeight={contentHeight} flexGrow={0} flexShrink={1} minHeight={0} overflow="hidden" flexDirection={collapsed ? "column" : "row"}>
    <box
      width={collapsed ? "100%" : summaryWidth}
      height={collapsed ? sidebarHeight : "100%"}
      flexShrink={0}
      minHeight={0}
      overflow="hidden"
      border={collapsed ? ["bottom"] : ["right"]}
      borderColor={chrome.line}
      flexDirection="column"
    >
      <box height={5}>
        <DetailSummary
          burnlist={props.selectedBurnlist}
          progress={props.progress}
          fireWidth={Number(summary?.attributes.fireWidth ?? 12)}
          fireHeight={Number(summary?.attributes.fireHeight ?? 7)}
          fps={Number(summary?.attributes.fps ?? 12)}
          compact
          width={collapsed ? width : summaryWidth}
        />
      </box>
      {runtime?.status === "ready" ? <TerminalOvenViewport
        result={runtime}
        footer="q:back"
      /> : <>
      {runtime ? <box height={2} overflow="hidden"><text fg={palette.dim}>{`LEGACY FALLBACK · ${runtime.diagnostics.at(-1)?.message ?? runtime.status}`}</text></box> : null}
      <OvenPane
        active={props.activeOven}
        lenses={props.ovenLenses}
        progress={props.progress}
        data={props.ovenData}
        burnlist={props.selectedBurnlist}
        height={Math.max(1, sidebarHeight - 5)}
        width={collapsed ? width : summaryWidth}
        itemIndex={props.itemIndex}
      /></>}
    </box>
    <box flexGrow={1} minWidth={0} minHeight={0} overflow="hidden">
      <ItemDetail
        item={props.selectedItem}
        oven={props.activeOven}
        progress={props.progress}
        data={props.ovenData}
        domainIndex={props.domainIndex}
        width={collapsed ? width : width - summaryWidth}
        height={collapsed ? Math.max(1, contentHeight - sidebarHeight) : contentHeight}
      />
    </box>
  </box>;
}
function StreamingSession({ props, width, height }: { props: ScreenRuntimeProps; width: number; height: number }) {
  const navigation = props.streamingNavigation!, error = navigation.sessionError, available = Math.max(3, height - 1 - (error ? 1 : 0));
  const runtime = props.ovenRuntime ? prepareTerminalComponentResult({ ...props.ovenRuntime, state: { ...props.ovenRuntime.state, viewport: { width: Math.max(1, width - 6), height: available } } }) : null;
  return <box height={height} paddingLeft={3} paddingRight={3} paddingTop={1} overflow="hidden" flexDirection="column">{error ? <box height={1} overflow="hidden"><text fg={palette.amber}>{fitText(error, Math.max(1, width - 6))}</text></box> : null}{runtime ? <TerminalOvenViewport result={runtime} footer="←/→:card · ↑/↓:file · enter:expand · r:refresh · q:feeds" streaming={{ selectedCard: navigation.selectedCard, selectedFile: navigation.selectedFile, expandedKey: navigation.expandedFile }} /> : <text>Loading session…</text>}</box>;
}

function renderNode(node: GlyphNode, props: ScreenRuntimeProps, width: number, height: number, chrome: TerminalChrome): React.ReactNode {
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
        maxRows={Math.max(2, height - 4)}
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
      if (props.streamingNavigation) return props.streamingNavigation.page === "feeds" ? <box key={key} height={height - 3} paddingLeft={3} paddingRight={3} paddingTop={1} overflow="hidden"><TerminalStreamingFeedList payload={{ feeds: props.streamingNavigation.feeds, ...(props.streamingNavigation.feedStatus === "loading" ? { loading: true } : props.streamingNavigation.feedStatus === "error" ? { error: props.streamingNavigation.sessionError } : {}) }} selectedFeed={props.streamingNavigation.selectedFeed} width={Math.max(1, width - 6)} height={height - 4} /></box> : <StreamingSession key={key} props={props} width={width} height={height - 3} />;
      return <CatalogOvenDetail key={key} summary={props.activeOven} detail={props.ovenDetail} height={height - 3} />;
    case "item-detail":
      return <ItemDetail key={key} item={props.selectedItem} oven={props.activeOven} progress={props.progress} data={props.ovenData} domainIndex={props.domainIndex} width={width} height={height - 3} />;
    case "footer":
      return <box key={key} height={2} flexShrink={0} zIndex={10} flexDirection="row" justifyContent="flex-start" border={["top"]} borderColor={chrome.line} paddingLeft={3} alignItems="center">
        <text fg={palette.dim}>{String(node.attributes.hints)}</text>
      </box>;
    default:
      return null;
  }
}

function ScreenSurface(props: ScreenRuntimeProps) {
  const { width, height } = useTerminalDimensions();
  const chrome = useTerminalChrome();
  return <box width="100%" height="100%" flexDirection="column" overflow="hidden" backgroundColor={chrome.background}>
    {props.screen.root.children.map((node) => renderNode(node, props, width, height, chrome))}
  </box>;
}

export function ScreenRuntime(props: ScreenRuntimeProps) {
  return <TerminalChromeProvider><ScreenSurface {...props} /></TerminalChromeProvider>;
}
