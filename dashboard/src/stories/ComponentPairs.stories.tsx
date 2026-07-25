import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import {
  Alert as ConsoleAlert, AlertDescription, AlertTitle, Badge as ConsoleBadge, Button as ConsoleButton, Card as ConsoleCard, CardContent,
  CardDescription, CardHeader, CardTitle, Checkbox as ConsoleCheckbox, Field as ConsoleField,
  FieldDescription, FieldError, FieldLabel, Input as ConsoleInput, Progress as ConsoleProgress,
  Select as ConsoleSelect, Separator as ConsoleSeparator, Skeleton as ConsoleSkeleton,
  Spinner as ConsoleSpinner, Table as ConsoleTable, TableBody, TableCaption, TableCell,
  TableHead, TableHeader, TableRow, Tabs as ConsoleTabs, TabsContent, TabsList,
  TabsTrigger, Textarea as ConsoleTextarea, ToggleGroup as ConsoleToggleGroup,
  ToggleGroupItem, Tooltip as ConsoleTooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@layout";
import { CopyButton as ConsoleCopyButton } from "../components/CopyButton/CopyButton";
import { DashboardError as ConsoleDashboardError } from "../components/DashboardError/DashboardError";
import { EmptyState as ConsoleEmptyState } from "../components/EmptyState/EmptyState";
import { Filters as ConsoleFilters } from "../components/Filters/Filters";
import { TerminalFrame, PairedPreview, componentPairFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { HybridFieldList } from "../oven/HybridFieldList/HybridFieldList";
import { DifferentialTestingDetail } from "../oven/runtime/differential-testing-detail";
import {
  componentPairFixture,
  type ComponentPairId,
} from "../../../tui/src/catalog/component-pair-fixture";
import "../components/DifferentialTesting/differential-testing.css";

const fixture = componentPairFixture;
const fields = fixture.fieldListCards.fields.map((field) => ({
  id: field.id, label: field.label, trustStatus: "pass", failedSampleCount: field.failures,
  missingSampleCount: 0, maxDelta: field.delta, samples: [[0, 0, 0, 0], [1, 1, 1 + field.delta, field.failures]],
}));

function AlertPreview() { return <ConsoleAlert variant="success"><AlertTitle>{fixture.alert.title}</AlertTitle><AlertDescription>{fixture.alert.detail}</AlertDescription></ConsoleAlert>; }
function BadgePreview() { return <ConsoleBadge>{fixture.badge.label}</ConsoleBadge>; }
function ButtonPreview() { return <div className="storybook-row"><ConsoleButton>{fixture.button.label}</ConsoleButton><ConsoleButton disabled>{fixture.button.disabledLabel}</ConsoleButton></div>; }
function CardPreview() { return <ConsoleCard className="storybook-card-demo"><CardHeader><CardTitle>{fixture.card.title}</CardTitle><CardDescription>{fixture.card.detail}</CardDescription></CardHeader><CardContent>{fixture.card.meta}</CardContent></ConsoleCard>; }
function CheckboxPreview() { return <label className="storybook-checkbox-row"><ConsoleCheckbox checked={fixture.checkbox.checked} />{fixture.checkbox.label}</label>; }
function FieldPreview() { return <ConsoleField className="storybook-control-demo"><FieldLabel>{fixture.field.label}</FieldLabel><ConsoleInput value={fixture.field.value} readOnly /><FieldDescription>{fixture.field.detail}</FieldDescription><FieldError>{fixture.field.error}</FieldError></ConsoleField>; }
function InputPreview() { return <ConsoleField className="storybook-control-demo"><FieldLabel>{fixture.input.label}</FieldLabel><ConsoleInput value={fixture.input.value} readOnly /></ConsoleField>; }
function ProgressPreview() { return <div className="storybook-progress-demo"><span>{fixture.progress.value}%</span><ConsoleProgress aria-label={fixture.progress.label} value={fixture.progress.value} /></div>; }
function SelectPreview() { return <ConsoleField className="storybook-control-demo"><FieldLabel>{fixture.select.label}</FieldLabel><ConsoleSelect value={fixture.select.value} readOnly>{fixture.select.options.map((option) => <option key={option}>{option}</option>)}</ConsoleSelect></ConsoleField>; }
function SeparatorPreview() { return <div className="storybook-separator-demo"><span>{fixture.separator.before}</span><ConsoleSeparator /><span>{fixture.separator.after}</span></div>; }
function SkeletonPreview() { return <div aria-label={fixture.skeleton.label} className="storybook-stack">{fixture.skeleton.rows.map((row) => <ConsoleSkeleton key={row} style={{ width: row * 8 }} />)}</div>; }
function SpinnerPreview() { return <ConsoleSpinner label={fixture.spinner.label} />; }
function TablePreview() { return <ConsoleTable><TableCaption>{fixture.table.caption}</TableCaption><TableHeader><TableRow>{fixture.table.headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{fixture.table.rows.map((row) => <TableRow key={row[1]}>{row.map((cell) => <TableCell key={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody></ConsoleTable>; }
function TabsPreview() { return <ConsoleTabs value={fixture.tabs.selected.toLowerCase()}><TabsList aria-label={fixture.tabs.label}>{fixture.tabs.tabs.map((tab) => <TabsTrigger key={tab} value={tab.toLowerCase()}>{tab}</TabsTrigger>)}</TabsList><TabsContent value={fixture.tabs.selected.toLowerCase()}>{fixture.tabs.panel}</TabsContent></ConsoleTabs>; }
function TextareaPreview() { return <ConsoleField className="storybook-control-demo"><FieldLabel>{fixture.textarea.label}</FieldLabel><ConsoleTextarea value={fixture.textarea.value} readOnly /></ConsoleField>; }
function ToggleGroupPreview() { return <ConsoleToggleGroup aria-label={fixture.toggleGroup.label} value={fixture.toggleGroup.selected.toLowerCase()} type="single">{fixture.toggleGroup.options.map((option) => <ToggleGroupItem key={option} value={option.toLowerCase()}>{option}</ToggleGroupItem>)}</ConsoleToggleGroup>; }
function TooltipPreview() { return <TooltipProvider delayDuration={0}><ConsoleTooltip defaultOpen><TooltipTrigger aria-label={fixture.tooltip.label} asChild><ConsoleButton variant="outline">{fixture.tooltip.label}</ConsoleButton></TooltipTrigger><TooltipContent>{fixture.tooltip.detail}</TooltipContent></ConsoleTooltip></TooltipProvider>; }
function CopyButtonPreview() { return <div className="storybook-row"><code>{fixture.copyButton.value}</code><ConsoleCopyButton text={fixture.copyButton.value} /></div>; }
function DashboardErrorPreview() { return <ConsoleDashboardError message={fixture.dashboardError.message} />; }
function EmptyStatePreview() { return <ConsoleEmptyState title={fixture.emptyState.title} detail={fixture.emptyState.detail} />; }
function FiltersPreview() { return <ConsoleFilters filter={fixture.filters.selected.toLowerCase() as "active"} onFilterChange={() => {}} />; }
function FieldListCardsPreview() { return <div className="shell driving-parity-view storybook-oven-pattern storybook-field-list-pattern"><HybridFieldList fields={fields} chartMode="delta" /></div>; }
function TopCardPreview() { return <div className="shell driving-parity-view storybook-oven-pattern storybook-top-card-pattern"><DifferentialTestingDetail
  payload={{ primaryChartTitle: fixture.topCard.title, historyTitle: "Run log", publishedAt: fixture.topCard.publishedAt }}
  progressMode="delta" refresh={<span>ready</span>}
  kpis={<div className="differential-kpi-strip">Tasks {fixture.topCard.tasks} · Elapsed {fixture.topCard.elapsed} · Pace {fixture.topCard.pace} · Done {fixture.topCard.done}</div>}
  chart={<div role="img" aria-label={fixture.topCard.title}>━━━━━━━━━━━━━━·······</div>} log={<div>{fixture.topCard.log}</div>}
/></div>; }

function ComponentPair({ id, consolePreview }: { id: ComponentPairId; consolePreview: ReactNode }) {
  const entry = componentPairFrameEntries.find((candidate) => candidate.id === `component-${id}:72x10:default`);
  if (!entry) return <p role="status">No source-backed OpenTUI frame exists for {id}.</p>;
  return <div style={{ width: "min(100%, 1080px)" }}>
    <p className="storybook-label">One typed fixture drives this console component and its terminal counterpart.</p>
    <PairedPreview consolePreview={consolePreview} terminalPreview={<TerminalFrame entry={entry} />} />
  </div>;
}

const meta = {
  title: "Terminal counterparts/Console components",
  component: ComponentPair,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ComponentPair>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alert: Story = { render: () => <ComponentPair id="alert" consolePreview={<AlertPreview />} /> };
export const Badge: Story = { render: () => <ComponentPair id="badge" consolePreview={<BadgePreview />} /> };
export const Button: Story = { render: () => <ComponentPair id="button" consolePreview={<ButtonPreview />} /> };
export const Card: Story = { render: () => <ComponentPair id="card" consolePreview={<CardPreview />} /> };
export const Checkbox: Story = { render: () => <ComponentPair id="checkbox" consolePreview={<CheckboxPreview />} /> };
export const Field: Story = { render: () => <ComponentPair id="field" consolePreview={<FieldPreview />} /> };
export const Input: Story = { render: () => <ComponentPair id="input" consolePreview={<InputPreview />} /> };
export const Progress: Story = { render: () => <ComponentPair id="progress" consolePreview={<ProgressPreview />} /> };
export const Select: Story = { render: () => <ComponentPair id="select" consolePreview={<SelectPreview />} /> };
export const Separator: Story = { render: () => <ComponentPair id="separator" consolePreview={<SeparatorPreview />} /> };
export const Skeleton: Story = { render: () => <ComponentPair id="skeleton" consolePreview={<SkeletonPreview />} /> };
export const Spinner: Story = { render: () => <ComponentPair id="spinner" consolePreview={<SpinnerPreview />} /> };
export const Table: Story = { render: () => <ComponentPair id="table" consolePreview={<TablePreview />} /> };
export const Tabs: Story = { render: () => <ComponentPair id="tabs" consolePreview={<TabsPreview />} /> };
export const Textarea: Story = { render: () => <ComponentPair id="textarea" consolePreview={<TextareaPreview />} /> };
export const ToggleGroup: Story = { render: () => <ComponentPair id="toggle-group" consolePreview={<ToggleGroupPreview />} /> };
export const Tooltip: Story = { render: () => <ComponentPair id="tooltip" consolePreview={<TooltipPreview />} /> };
export const CopyButton: Story = { render: () => <ComponentPair id="copy-button" consolePreview={<CopyButtonPreview />} /> };
export const DashboardError: Story = { render: () => <ComponentPair id="dashboard-error" consolePreview={<DashboardErrorPreview />} /> };
export const EmptyState: Story = { render: () => <ComponentPair id="empty-state" consolePreview={<EmptyStatePreview />} /> };
export const Filters: Story = { render: () => <ComponentPair id="filters" consolePreview={<FiltersPreview />} /> };
export const FieldListCards: Story = { render: () => <ComponentPair id="field-list-cards" consolePreview={<FieldListCardsPreview />} /> };
export const TopCard: Story = { render: () => <ComponentPair id="top-card" consolePreview={<TopCardPreview />} /> };
