import { fitText } from "../theme";
import { LoadingStar } from "../loading-star";
import { useTerminalPalette } from "../terminal-accessibility";
import { useTerminalChrome } from "../terminal-chrome";
import { TerminalLineChart, type TerminalChartPoint } from "../terminal-line-chart";
import { GlyphImage } from "../glyph-image";
import { progressGlyphFrame } from "../oven-runtime/components/progress-glyph";
import { TerminalMetricTiles } from "../oven-runtime/components/media-components";
import { componentPairFixture, type ComponentPairId } from "./component-pair-fixture";
import { componentMediaPng } from "./component-media-fixture";
import "../glyph-surface";

type SurfaceProps = { width: number; animationPhase?: number };

function Frame({ children, width }: React.PropsWithChildren<SurfaceProps>) {
  const chrome = useTerminalChrome();
  return <box width={width} height="100%" flexDirection="column" overflow="hidden" backgroundColor={chrome.background} paddingLeft={1} paddingRight={1}>
    {children}
  </box>;
}

export function TerminalAlert({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.alert;
  return <Frame width={width}><text fg={palette.green}>✓ {value.title}</text><text fg={palette.muted}>{fitText(value.detail, width - 2)}</text></Frame>;
}

export function TerminalBadge({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.badge;
  return <Frame width={width}><text fg={palette.blue}>[ {value.label} ]</text></Frame>;
}

export function TerminalButton({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.button;
  return <Frame width={width}><text><span fg={palette.blue}>[ {value.label} ]</span>  <span fg={palette.dim}>[ {value.disabledLabel} ]</span></text></Frame>;
}

export function TerminalCard({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), chrome = useTerminalChrome(), value = componentPairFixture.card;
  return <Frame width={width}><box border={["top", "bottom"]} borderColor={chrome.line} flexDirection="column" paddingLeft={1}><text fg={palette.foreground}>{value.title}</text><text fg={palette.muted}>{fitText(value.detail, width - 5)}</text><text fg={palette.dim}>{value.meta}</text></box></Frame>;
}

export function TerminalCheckbox({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.checkbox;
  return <Frame width={width}><text><span fg={palette.blue}>{value.checked ? "☑" : "☐"}</span> {value.label}</text></Frame>;
}

export function TerminalField({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.field;
  return <Frame width={width}><text fg={palette.foreground}>{value.label}</text><text>› {value.value}█</text><text fg={palette.muted}>{fitText(value.detail, width - 2)}</text><text fg={palette.red}>! {value.error}</text></Frame>;
}

export function TerminalInput({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.input;
  return <Frame width={width}><text fg={palette.muted}>{value.label}</text><text>› {value.value}█</text></Frame>;
}

export function TerminalProgress({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.progress;
  const filled = Math.round(value.value / 10);
  return <Frame width={width}><text fg={palette.muted}>{value.label}</text><text><span fg={palette.green}>{String(value.value).padStart(3)}%</span> {"━".repeat(filled)}{"·".repeat(10 - filled)}</text></Frame>;
}

export function TerminalSelect({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.select;
  return <Frame width={width}><text fg={palette.muted}>{value.label}</text><text><span fg={palette.blue}>◇ [{value.value}]</span>  {value.options.join(" · ")}</text></Frame>;
}

export function TerminalSeparator({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.separator;
  return <Frame width={width}><text>{value.before}</text><text fg={palette.dim}>{"─".repeat(Math.max(1, width - 2))}</text><text>{value.after}</text></Frame>;
}

export function TerminalSkeleton({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.skeleton;
  return <Frame width={width}><text fg={palette.muted}>{value.label}</text>{value.rows.map((row) => <text key={row} fg={palette.dim}>{"▒".repeat(Math.min(row, width - 2))}</text>)}</Frame>;
}

export function TerminalSpinner({ width, animationPhase }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.spinner;
  return <Frame width={width}><LoadingStar label={value.label} phase={animationPhase} /><text fg={palette.dim}>· × + * ✦ · shared loading cadence</text></Frame>;
}

export function TerminalTable({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.table;
  return <Frame width={width}><text fg={palette.muted}>{value.caption}</text><text fg={palette.dim}>{fitText(value.headers.join("  "), width - 2)}</text>{value.rows.map((row) => <text key={row[1]}>{fitText(row.join("  "), width - 2)}</text>)}</Frame>;
}

export function TerminalTabs({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.tabs;
  return <Frame width={width}><text>{value.tabs.map((tab) => tab === value.selected ? `[${tab}]` : tab).join("  ")}</text><text fg={palette.blue}>{"─".repeat(value.selected.length + 2)}</text><text>{value.panel}</text></Frame>;
}

export function TerminalTextarea({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.textarea;
  const middle = Math.ceil(value.value.length / 2);
  return <Frame width={width}><text fg={palette.muted}>{value.label}</text><box border={["top", "bottom"]} borderColor={palette.dim} flexDirection="column" paddingLeft={1}><text>{fitText(value.value.slice(0, middle), width - 5)}</text><text>{fitText(`${value.value.slice(middle)}█`, width - 5)}</text></box></Frame>;
}

export function TerminalToggleGroup({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.toggleGroup;
  return <Frame width={width}><text fg={palette.muted}>{value.label}</text><text>{value.options.map((option) => option === value.selected ? `[${option}]` : option).join("  ")}</text></Frame>;
}

export function TerminalTooltip({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.tooltip;
  return <Frame width={width}><text fg={palette.blue}>ⓘ {value.label}</text><text fg={palette.muted}>╰─ {fitText(value.detail, width - 5)}</text></Frame>;
}

export function TerminalCopyButton({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.copyButton;
  return <Frame width={width}><text><span fg={palette.blue}>[ {value.label} ]</span>  {value.value}</text><text fg={palette.dim}>enter copies · confirmation: Copied ✓</text></Frame>;
}

export function TerminalDashboardError({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.dashboardError;
  return <Frame width={width}><text fg={palette.red}>⚠ Dashboard error</text><text>{fitText(value.message, width - 2)}</text></Frame>;
}

export function TerminalEmptyState({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.emptyState;
  return <Frame width={width}><text>○ {value.title}</text><text fg={palette.muted}>{fitText(value.detail, width - 2)}</text></Frame>;
}

export function TerminalFilters({ width }: SurfaceProps) {
  const value = componentPairFixture.filters;
  return <Frame width={width}><text>{value.options.map((option) => option === value.selected ? `[${option}]` : option).join("  ")}</text></Frame>;
}

export function TerminalFieldListCards({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.fieldListCards;
  const points = (field: typeof value.fields[number]): TerminalChartPoint[] => field.samples.map((sample) => ({
    label: `F${sample[0]}`,
    value: sample[2] - sample[1],
    state: sample[3] ? "fail" : "pass",
  }));
  return <Frame width={width}>
    <text fg={palette.dim}>FIELD PATH · exact delta by frame</text>
    {value.fields.map((field, index) => <TerminalLineChart
      key={field.id}
      width={width - 2}
      height={index === 0 ? 6 : 3}
      title={`${field.status === "pass" ? "✓" : "×"} ${field.label} · ${field.failures} fail · Δ ${field.delta}`}
      points={points(field)}
    />)}
  </Frame>;
}

export function TerminalTopCard({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.topCard;
  return <Frame width={width}>
    <text>{value.title}  <span fg={palette.dim}>{value.publishedAt}</span></text>
    <text>Tasks <span fg={palette.blue}>{value.tasks}</span>  Elapsed {value.elapsed}  Pace {value.pace}  Done <span fg={palette.green}>{value.done}</span></text>
    <TerminalLineChart width={width - 2} height={7} title={value.log} points={value.chart} />
  </Frame>;
}

function MetricGlyph({ kind, value, width }: { kind: "progress-donut" | "burn-donut" | "waffle-metric"; value: unknown; width: number }) {
  const palette = useTerminalPalette();
  const frame = progressGlyphFrame(kind, value, width, palette);
  return <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />;
}

export function TerminalKpiStripPair({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.kpiStrip;
  const cellWidth = Math.max(10, Math.floor((width - 2) / value.items.length));
  const visuals = [
    <MetricGlyph key="progress" kind="progress-donut" value={componentPairFixture.progressDonut.percent} width={cellWidth - 2} />,
    <MetricGlyph key="burns" kind="burn-donut" value={componentPairFixture.burnDonut.entries} width={cellWidth - 2} />,
    <MetricGlyph key="waffle" kind="waffle-metric" value={componentPairFixture.waffleMetric.metric} width={cellWidth - 2} />,
  ];
  return <Frame width={width}>
    <text fg={palette.muted}>{value.title}</text>
    <box flexDirection={width < 48 ? "column" : "row"} overflow="hidden">
      {value.items.map((item, index) => <box key={item.heading} width={width < 48 ? width - 2 : cellWidth} height={3} flexDirection="column" overflow="hidden">
        <text>{item.heading}</text>
        {visuals[index]}
        <text fg={palette.muted}>{item.value}</text>
      </box>)}
    </box>
  </Frame>;
}

export function TerminalKpiItemPair({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.kpiItem;
  return <Frame width={width}>
    <text>{value.heading}</text>
    <MetricGlyph kind="progress-donut" value={value.percent} width={Math.min(24, width - 2)} />
    <text fg={palette.muted}>{value.value}</text>
  </Frame>;
}

export function TerminalMetricTilesPair({ width }: SurfaceProps) {
  const value = componentPairFixture.metricTiles;
  const model = {
    domains: ["desktop"], selected: "desktop", note: "", frames: [],
    metrics: [
      ["Frames", `${value.passed}/${value.total}`],
      ["Changed", `${(value.ratio * 100).toFixed(2)}%`],
      ["Mean RGB", value.meanAbsoluteDelta.toFixed(3)],
      ["Max delta", String(value.maximumAbsoluteDelta)],
    ] as Array<[string, string]>,
  };
  return <Frame width={width}><TerminalMetricTiles model={model} width={width - 2} /></Frame>;
}

export function TerminalProgressDonutPair({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.progressDonut;
  return <Frame width={width}><text>Progress donut</text><MetricGlyph kind="progress-donut" value={value.percent} width={Math.min(32, width - 2)} /><text fg={palette.muted}>{value.label}</text></Frame>;
}

export function TerminalBurnDonutPair({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.burnDonut;
  return <Frame width={width}><text>Result distribution</text><MetricGlyph kind="burn-donut" value={value.entries} width={Math.min(32, width - 2)} /><text fg={palette.muted}>{fitText(value.label, width - 2)}</text></Frame>;
}

export function TerminalWaffleMetricPair({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.waffleMetric;
  return <Frame width={width}><text>Field parity</text><MetricGlyph kind="waffle-metric" value={value.metric} width={Math.min(32, width - 2)} /><text fg={palette.muted}>{value.label}</text></Frame>;
}

export function TerminalVisualParityMedia({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.visualParityMedia;
  const imageWidth = Math.max(4, Math.floor((width - 4) / value.images.length));
  return <Frame width={width}>
    <text>{value.label} · Frame {value.frame}</text>
    <box height={1} flexDirection="row">{value.images.map((image) => <text key={image.label} width={imageWidth}>{fitText(image.label, imageWidth)}</text>)}</box>
    <box height={6} flexDirection="row">{value.images.map((image) => <GlyphImage key={image.label} source={componentMediaPng[image.source]} width={imageWidth} height={6} />)}</box>
    <text fg={palette.muted}>glyphcss image cells · source / reference / difference</text>
  </Frame>;
}

export function TerminalLineChartPair({ width }: SurfaceProps) {
  const value = componentPairFixture.lineChart;
  return <Frame width={width}><TerminalLineChart width={width - 2} height={9} title={value.title} points={value.points} /></Frame>;
}

const surfaces: Record<ComponentPairId, (props: SurfaceProps) => React.ReactNode> = {
  alert: TerminalAlert,
  badge: TerminalBadge,
  button: TerminalButton,
  card: TerminalCard,
  checkbox: TerminalCheckbox,
  field: TerminalField,
  input: TerminalInput,
  progress: TerminalProgress,
  select: TerminalSelect,
  separator: TerminalSeparator,
  skeleton: TerminalSkeleton,
  spinner: TerminalSpinner,
  table: TerminalTable,
  tabs: TerminalTabs,
  textarea: TerminalTextarea,
  "toggle-group": TerminalToggleGroup,
  tooltip: TerminalTooltip,
  "copy-button": TerminalCopyButton,
  "dashboard-error": TerminalDashboardError,
  "empty-state": TerminalEmptyState,
  filters: TerminalFilters,
  "field-list-cards": TerminalFieldListCards,
  "top-card": TerminalTopCard,
  "kpi-strip": TerminalKpiStripPair,
  "kpi-item": TerminalKpiItemPair,
  "metric-tiles": TerminalMetricTilesPair,
  "progress-donut": TerminalProgressDonutPair,
  "burn-donut": TerminalBurnDonutPair,
  "waffle-metric": TerminalWaffleMetricPair,
  "visual-parity-media": TerminalVisualParityMedia,
  "line-chart": TerminalLineChartPair,
};

export function TerminalComponentPair({ id, width, animationPhase }: SurfaceProps & { id: ComponentPairId }) {
  const Surface = surfaces[id];
  return <Surface width={width} animationPhase={animationPhase} />;
}
