import type { Meta, StoryObj } from "@storybook/react-vite";
import { DashboardError, EmptyState, Filters } from "@components";
import { CopyButton } from "../components/CopyButton/CopyButton";
import {
  Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Checkbox, Field, FieldDescription, FieldError, FieldGroup, FieldLabel, Input, Progress, Select, Separator, Skeleton, Spinner,
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
  ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@layout";
import { generalComponentsFixture, type GeneralComponentsCheckpoint } from "../../../tui/src/catalog/general-components-fixture";
import { generalComponentsFrameEntries, PairedPreview, TerminalFrame } from "../components/TerminalFrame/TerminalFrame";

const { labels, values } = generalComponentsFixture;

function Overview() {
  const { overview } = labels;
  return <div className="storybook-flow">
    <Card className="storybook-card-demo"><CardHeader><CardTitle>{overview.cardTitle}</CardTitle><CardDescription>{overview.cardDescription}</CardDescription></CardHeader><CardContent><div className="storybook-row">{generalComponentsFixture.badges.map((badge, index) => <Badge key={badge} variant={index === 1 ? "secondary" : index === 2 ? "destructive" : "default"}>{badge}</Badge>)}</div><Progress aria-label={`${generalComponentsFixture.progress[2]}% complete`} value={generalComponentsFixture.progress[2]} /></CardContent><CardFooter>{generalComponentsFixture.buttons.map((label, index) => <Button key={label} disabled={index === 2} size="sm" variant={index === 1 ? "outline" : "default"}>{label}</Button>)}</CardFooter></Card>
    <Separator />
    <Table><TableCaption>{overview.tableCaption}</TableCaption><TableHeader><TableRow>{overview.tableHeaders.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{generalComponentsFixture.table.map((row) => <TableRow key={row[1]}>{row.map((cell) => <TableCell key={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table>
  </div>;
}

function Forms({ checkpoint }: { checkpoint: "forms" | "interacted" }) {
  const state = generalComponentsFixture.states[checkpoint];
  const { forms } = labels;
  return <FieldGroup className="storybook-form-demo">
    <label className="storybook-checkbox-row"><Checkbox checked={state.includeCompleted} /> {forms.includeCompleted}</label>
    <Field><FieldLabel htmlFor="general-name">{forms.ovenName}</FieldLabel><Input defaultValue={values.ovenName} id="general-name" /><FieldDescription>{forms.ovenNameDescription}</FieldDescription></Field>
    <Field><FieldLabel htmlFor="general-lifecycle">{forms.lifecycle}</FieldLabel><Select defaultValue={state.lifecycle} id="general-lifecycle">{Object.entries(values.lifecycle).map(([key, value]) => <option key={key} value={value}>{key}</option>)}</Select></Field>
    <Field><FieldLabel htmlFor="general-objective">{forms.objective}</FieldLabel><Textarea id="general-objective" placeholder={values.objectivePlaceholder} /></Field>
    <Field><FieldLabel htmlFor="general-path">{forms.repositoryPath}</FieldLabel><Input aria-invalid="true" defaultValue={values.repositoryPath} id="general-path" /><FieldError>{forms.repositoryPathError}</FieldError></Field>
    <Tabs defaultValue={state.selectedTab}><TabsList>{generalComponentsFixture.tabs.map((tab) => <TabsTrigger key={tab} value={tab.toLowerCase()}>{tab}</TabsTrigger>)}</TabsList>{Object.entries(values.tabs).map(([key, value]) => <TabsContent key={key} value={key}>{value}</TabsContent>)}</Tabs>
    <ToggleGroup defaultValue={state.selectedView} type="single">{values.viewModes.map((mode) => <ToggleGroupItem key={mode} value={mode.toLowerCase()}>{mode}</ToggleGroupItem>)}</ToggleGroup>
    <Filters filter={state.lifecycle} onFilterChange={() => {}} />
  </FieldGroup>;
}

function Feedback() {
  const { feedback } = labels;
  return <div className="storybook-flow">
    <Alert variant="success"><AlertTitle>{feedback.verificationPassed}</AlertTitle><AlertDescription>{feedback.evidenceAvailable}</AlertDescription></Alert>
    <Alert variant="warning"><AlertTitle>{feedback.evidenceStale}</AlertTitle><AlertDescription>{feedback.refreshArtifacts}</AlertDescription></Alert>
    <DashboardError message={feedback.dashboardError} />
    <EmptyState title={feedback.emptyTitle} detail={feedback.emptyDetail} />
    <Card aria-busy="true"><CardHeader><Skeleton className="storybook-skeleton-title" /></CardHeader><CardContent><Skeleton className="storybook-skeleton-row" /><Spinner label={feedback.loadingSummary} /></CardContent></Card>
    <div className="storybook-row">{feedback.copyInstructions} <CopyButton text={feedback.copyValue} /><TooltipProvider delayDuration={0}><Tooltip defaultOpen><TooltipTrigger aria-label={feedback.canonicalStateDetail} asChild><Button variant="outline">{feedback.canonicalState}</Button></TooltipTrigger><TooltipContent>{feedback.canonicalStateDetail}</TooltipContent></Tooltip></TooltipProvider></div>
  </div>;
}

function NativeGeneral({ checkpoint }: { checkpoint: GeneralComponentsCheckpoint }) {
  const state = generalComponentsFixture.states[checkpoint];
  const content = state.visible === "overview" ? <Overview /> : state.visible === "feedback" ? <Feedback /> : <Forms checkpoint={checkpoint as "forms" | "interacted"} />;
  return <section data-expected-outcome={state.expectedOutcome}>{content}</section>;
}

function PairedGeneral({ checkpoint = "overview", viewport = 78 }: { checkpoint?: GeneralComponentsCheckpoint; viewport?: 36 | 78 }) {
  const entry = generalComponentsFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport);
  return entry ? <PairedPreview consolePreview={<NativeGeneral checkpoint={checkpoint} />} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated general-component frame exists.</p>;
}

const meta = {
  title: "Patterns/General console-terminal components",
  component: PairedGeneral,
  args: { checkpoint: "overview", viewport: 78 },
  argTypes: {
    checkpoint: { control: "select", options: generalComponentsFixture.checkpoints },
    viewport: { control: "select", options: [36, 78] },
  },
  parameters: { layout: "centered", terminalParityOwner: "terminal-frame" },
} satisfies Meta<typeof PairedGeneral>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Paired = {} satisfies Story;
