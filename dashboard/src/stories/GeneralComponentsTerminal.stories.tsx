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

function Overview() {
  return <div className="storybook-flow">
    <Card className="storybook-card-demo"><CardHeader><CardTitle>Differential Testing</CardTitle><CardDescription>Exact-first comparison against the bound native source.</CardDescription></CardHeader><CardContent><div className="storybook-row"><Badge>active</Badge><Badge variant="secondary">ready</Badge><Badge variant="destructive">blocked</Badge></div><Progress aria-label="68% complete" value={68} /></CardContent><CardFooter><Button size="sm">Run burn</Button><Button size="sm" variant="outline">Open Oven</Button><Button disabled size="sm">Unavailable</Button></CardFooter></Card>
    <Separator />
    <Table><TableCaption>Local Burnlists discovered across configured repositories.</TableCaption><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Burnlist</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead></TableRow></TableHeader><TableBody>{generalComponentsFixture.table.map((row) => <TableRow key={row[1]}>{row.map((cell) => <TableCell key={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table>
  </div>;
}

function Forms({ interacted }: { interacted: boolean }) {
  return <FieldGroup className="storybook-form-demo">
    <label className="storybook-checkbox-row"><Checkbox checked={interacted} /> Include completed Burnlists</label>
    <Field><FieldLabel htmlFor="general-name">Oven name</FieldLabel><Input defaultValue="Release readiness" id="general-name" /><FieldDescription>A short label shown in the dashboard.</FieldDescription></Field>
    <Field><FieldLabel htmlFor="general-lifecycle">Lifecycle</FieldLabel><Select defaultValue={interacted ? "complete" : "active"} id="general-lifecycle"><option value="active">Active</option><option value="complete">Complete</option></Select></Field>
    <Field><FieldLabel htmlFor="general-objective">Objective</FieldLabel><Textarea id="general-objective" placeholder="Describe the measurable outcome." /></Field>
    <Field><FieldLabel htmlFor="general-path">Repository path</FieldLabel><Input aria-invalid="true" defaultValue="relative/path" id="general-path" /><FieldError>Use an absolute repository path.</FieldError></Field>
    <Tabs defaultValue={interacted ? "complete" : "active"}><TabsList><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="complete">Complete</TabsTrigger><TabsTrigger value="blocked">Blocked</TabsTrigger></TabsList><TabsContent value="active">Three Burnlists are cooking.</TabsContent><TabsContent value="complete">Completed work is retained.</TabsContent></Tabs>
    <ToggleGroup defaultValue={interacted ? "chart" : "table"} type="single"><ToggleGroupItem value="list">List</ToggleGroupItem><ToggleGroupItem value="table">Table</ToggleGroupItem><ToggleGroupItem value="chart">Chart</ToggleGroupItem></ToggleGroup>
    <Filters filter={interacted ? "complete" : "active"} onFilterChange={() => {}} />
  </FieldGroup>;
}

function Feedback() {
  return <div className="storybook-flow">
    <Alert variant="success"><AlertTitle>Verification passed</AlertTitle><AlertDescription>All required evidence is available.</AlertDescription></Alert>
    <Alert variant="warning"><AlertTitle>Evidence is stale</AlertTitle><AlertDescription>Refresh retained artifacts.</AlertDescription></Alert>
    <DashboardError message="Could not read local state." />
    <EmptyState title="No Burnlists found" detail="Register a repository or adjust lifecycle filters." />
    <Card aria-busy="true"><CardHeader><Skeleton className="storybook-skeleton-title" /></CardHeader><CardContent><Skeleton className="storybook-skeleton-row" /><Spinner label="Loading summary" /></CardContent></Card>
    <div className="storybook-row">Copy instructions <CopyButton text="burnlist oven use checklist" /><TooltipProvider delayDuration={0}><Tooltip defaultOpen><TooltipTrigger aria-label="Explain canonical state" asChild><Button variant="outline">Canonical state</Button></TooltipTrigger><TooltipContent>Source used to derive this view.</TooltipContent></Tooltip></TooltipProvider></div>
  </div>;
}

function NativeGeneral({ checkpoint }: { checkpoint: GeneralComponentsCheckpoint }) {
  if (checkpoint === "overview") return <Overview />;
  if (checkpoint === "feedback") return <Feedback />;
  return <Forms interacted={checkpoint === "interacted"} />;
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
