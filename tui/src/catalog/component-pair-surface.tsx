import { useMemo } from "react";
import { TERMINAL_LOADING_FRAMES, useTerminalLoadingGlyph } from "../loading-cadence";
import { useTerminalAccessibility, useTerminalPalette } from "../terminal-accessibility";
import { useTerminalChrome } from "../terminal-chrome";
import {
  componentPairLiveFrame,
  componentPairViewport,
  type ComponentPairLiveArgs,
} from "./component-pair-live-model";
import type { ComponentPairId } from "./component-pair-fixture";
import { componentPairRegions } from "./component-pair-layout";
import "../glyph-surface";

type SurfaceProps = {
  width: number;
  height?: number;
  animationPhase?: number;
  args?: ComponentPairLiveArgs;
};

function PairSurface({ id, width, height, animationPhase, args = {} }: SurfaceProps & { id: ComponentPairId }) {
  const palette = useTerminalPalette(), accessibility = useTerminalAccessibility(), chrome = useTerminalChrome();
  const animatedGlyph = useTerminalLoadingGlyph(id === "spinner" && animationPhase === undefined);
  const phase = animationPhase ?? Math.max(0, TERMINAL_LOADING_FRAMES.indexOf(animatedGlyph as typeof TERMINAL_LOADING_FRAMES[number]));
  const viewport = componentPairViewport(id), rows = height ?? viewport.height;
  const frame = useMemo(
    () => componentPairLiveFrame(id, { ...args, reducedMotion: accessibility.reducedMotion }, { width, height: rows, palette, phase }),
    [accessibility.reducedMotion, args, id, palette, phase, rows, width],
  );
  const regions = componentPairRegions(id, width, rows);
  return <box width={width} height={rows} overflow="hidden" backgroundColor={chrome.background}>
    <glyphSurface
      cellBackground={chrome.background}
      cellBackgroundRegions={regions.map((region) => ({ ...region, color: chrome.surface }))}
      frame={frame}
      height={frame.rows}
      width={frame.cols}
    />
  </box>;
}

export const TerminalAlert = (props: SurfaceProps) => <PairSurface id="alert" {...props} />;
export const TerminalBadge = (props: SurfaceProps) => <PairSurface id="badge" {...props} />;
export const TerminalButton = (props: SurfaceProps) => <PairSurface id="button" {...props} />;
export const TerminalCard = (props: SurfaceProps) => <PairSurface id="card" {...props} />;
export const TerminalCheckbox = (props: SurfaceProps) => <PairSurface id="checkbox" {...props} />;
export const TerminalField = (props: SurfaceProps) => <PairSurface id="field" {...props} />;
export const TerminalInput = (props: SurfaceProps) => <PairSurface id="input" {...props} />;
export const TerminalProgress = (props: SurfaceProps) => <PairSurface id="progress" {...props} />;
export const TerminalSelect = (props: SurfaceProps) => <PairSurface id="select" {...props} />;
export const TerminalSeparator = (props: SurfaceProps) => <PairSurface id="separator" {...props} />;
export const TerminalSkeleton = (props: SurfaceProps) => <PairSurface id="skeleton" {...props} />;
export const TerminalSpinner = (props: SurfaceProps) => <PairSurface id="spinner" {...props} />;
export const TerminalTable = (props: SurfaceProps) => <PairSurface id="table" {...props} />;
export const TerminalTabs = (props: SurfaceProps) => <PairSurface id="tabs" {...props} />;
export const TerminalTextarea = (props: SurfaceProps) => <PairSurface id="textarea" {...props} />;
export const TerminalToggleGroup = (props: SurfaceProps) => <PairSurface id="toggle-group" {...props} />;
export const TerminalTooltip = (props: SurfaceProps) => <PairSurface id="tooltip" {...props} />;
export const TerminalCopyButton = (props: SurfaceProps) => <PairSurface id="copy-button" {...props} />;
export const TerminalDashboardError = (props: SurfaceProps) => <PairSurface id="dashboard-error" {...props} />;
export const TerminalEmptyState = (props: SurfaceProps) => <PairSurface id="empty-state" {...props} />;
export const TerminalFilters = (props: SurfaceProps) => <PairSurface id="filters" {...props} />;
export const TerminalFieldListCards = (props: SurfaceProps) => <PairSurface id="field-list-cards" {...props} />;
export const TerminalTopCard = (props: SurfaceProps) => <PairSurface id="top-card" {...props} />;
export const TerminalKpiStripPair = (props: SurfaceProps) => <PairSurface id="kpi-strip" {...props} />;
export const TerminalKpiItemPair = (props: SurfaceProps) => <PairSurface id="kpi-item" {...props} />;
export const TerminalMetricTilesPair = (props: SurfaceProps) => <PairSurface id="metric-tiles" {...props} />;
export const TerminalProgressDonutPair = (props: SurfaceProps) => <PairSurface id="progress-donut" {...props} />;
export const TerminalBurnDonutPair = (props: SurfaceProps) => <PairSurface id="burn-donut" {...props} />;
export const TerminalWaffleMetricPair = (props: SurfaceProps) => <PairSurface id="waffle-metric" {...props} />;
export const TerminalVisualParityMedia = (props: SurfaceProps) => <PairSurface id="visual-parity-media" {...props} />;
export const TerminalSeriesChartPair = (props: SurfaceProps) => <PairSurface id="line-chart" {...props} />;
/** @deprecated Use the truthful ordered-series component name. */
export const TerminalLineChartPair = TerminalSeriesChartPair;

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
  "line-chart": TerminalSeriesChartPair,
};

export function TerminalComponentPair({ id, ...props }: SurfaceProps & { id: ComponentPairId }) {
  const Surface = surfaces[id];
  return <Surface {...props} />;
}
