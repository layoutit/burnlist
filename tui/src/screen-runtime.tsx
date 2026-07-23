import { useTerminalDimensions } from "@opentui/react";
import type { GlyphNode, GlyphScreen } from "../../src/glyph/glyph-compile.mjs";
import { CatalogOvenDetail } from "./catalog-view";
import { BrandHeader, DetailSummary } from "./detail-view";
import { ItemDetail } from "./item-view";
import { BurnlistList, LandingSectionHeading, OvenList } from "./landing-view";
import { genericOvens } from "./oven-fit";
import { OvenPane } from "./oven-view";
import { palette } from "./theme";
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
  return <box flexGrow={1} flexDirection={collapsed ? "column" : "row"}>
    <box
      width={collapsed ? "100%" : summaryWidth}
      height={collapsed ? Math.max(12, Math.floor(height * 0.55)) : "100%"}
      flexShrink={0}
      border={collapsed ? ["bottom"] : ["right"]}
      borderColor={chrome.line}
      flexDirection="column"
    >
      <box height={8} border={["bottom"]} borderColor={chrome.faintLine}>
        <DetailSummary
          burnlist={props.selectedBurnlist}
          progress={props.progress}
          fireWidth={Number(summary?.attributes.fireWidth ?? 12)}
          fireHeight={Number(summary?.attributes.fireHeight ?? 7)}
          fps={Number(summary?.attributes.fps ?? 12)}
          compact
        />
      </box>
      <OvenPane
        active={props.activeOven}
        lenses={props.ovenLenses}
        progress={props.progress}
        data={props.ovenData}
        burnlist={props.selectedBurnlist}
        height={collapsed ? Math.floor(height * 0.55) - 8 : height - 15}
        itemIndex={props.itemIndex}
      />
    </box>
    <box flexGrow={1} minWidth={0}>
      <ItemDetail
        item={props.selectedItem}
        oven={props.activeOven}
        progress={props.progress}
        data={props.ovenData}
        domainIndex={props.domainIndex}
        width={collapsed ? width : width - summaryWidth}
        height={collapsed ? Math.max(8, Math.ceil(height * 0.45) - 7) : height - 7}
      />
    </box>
  </box>;
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
      return <BrandHeader key={key} center={center} subtitle={subtitle} compact={compact} />;
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
      return <CatalogOvenDetail key={key} summary={props.activeOven} detail={props.ovenDetail} height={height - 7} />;
    case "item-detail":
      return <ItemDetail key={key} item={props.selectedItem} oven={props.activeOven} progress={props.progress} data={props.ovenData} domainIndex={props.domainIndex} width={width} height={height - 7} />;
    case "footer":
      return <box key={key} height={2} flexDirection="row" justifyContent="flex-start" border={["top"]} borderColor={chrome.line} paddingLeft={3} alignItems="center">
        <text fg={palette.dim}>{String(node.attributes.hints)}</text>
      </box>;
    default:
      return null;
  }
}

function ScreenSurface(props: ScreenRuntimeProps) {
  const { width, height } = useTerminalDimensions();
  const chrome = useTerminalChrome();
  return <box width="100%" height="100%" flexDirection="column" backgroundColor={chrome.background}>
    {props.notice ? <box height={1} paddingLeft={2}><text fg={props.notice.tone === "error" ? palette.red : palette.amber}>{props.notice.message}</text></box> : null}
    {props.screen.root.children.map((node) => renderNode(node, props, width, height, chrome))}
  </box>;
}

export function ScreenRuntime(props: ScreenRuntimeProps) {
  return <TerminalChromeProvider><ScreenSurface {...props} /></TerminalChromeProvider>;
}
