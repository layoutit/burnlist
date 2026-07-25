import { fitText } from "../theme";
import { useTerminalPalette } from "../terminal-accessibility";
import { useTerminalChrome } from "../terminal-chrome";
import { componentPairFixture, type ComponentPairId } from "./component-pair-fixture";

type SurfaceProps = { width: number };

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

export function TerminalSpinner({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), value = componentPairFixture.spinner;
  return <Frame width={width}><text><span fg={palette.blue}>{value.frame}</span> {value.label}</text><text fg={palette.dim}>animated glyph frame</text></Frame>;
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
  return <Frame width={width}><text fg={palette.dim}>FIELD          RESULT  FAIL  Δ</text>{value.fields.map((field) => <text key={field.id}><span fg={field.status === "pass" ? palette.green : palette.red}>{field.status === "pass" ? "✓" : "×"} {field.label.padEnd(12)}</span> {field.status.padEnd(6)} {String(field.failures).padStart(3)}  {field.delta}</text>)}</Frame>;
}

export function TerminalTopCard({ width }: SurfaceProps) {
  const palette = useTerminalPalette(), chrome = useTerminalChrome(), value = componentPairFixture.topCard;
  return <Frame width={width}><box border={["top", "bottom"]} borderColor={chrome.line} flexDirection="column" paddingLeft={1}><text>{value.title}</text><text fg={palette.dim}>{value.publishedAt}</text><text>Tasks <span fg={palette.blue}>{value.tasks}</span>  Elapsed {value.elapsed}  Pace {value.pace}  Done <span fg={palette.green}>{value.done}</span></text><text>{"━".repeat(14)}{"·".repeat(7)}</text><text fg={palette.muted}>{value.log}</text></box></Frame>;
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
};

export function TerminalComponentPair({ id, width }: SurfaceProps & { id: ComponentPairId }) {
  const Surface = surfaces[id];
  return <Surface width={width} />;
}
