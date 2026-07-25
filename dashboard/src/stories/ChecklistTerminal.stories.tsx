import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChecklistDashboard } from "../components/ChecklistDashboard/ChecklistDashboard";
import { PairedPreview, TerminalFrame, checklistFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { checklistFixture } from "../../../tui/src/catalog/checklist-fixture";
type Checkpoint = typeof checklistFixture.checkpoints[number];
function Native({ checkpoint }: { checkpoint: Checkpoint }) { const data = checkpoint === "completed" ? checklistFixture.completed : checkpoint === "long-list" ? checklistFixture.longList : checklistFixture.active; return <ChecklistDashboard data={data.raw as never} />; }
function PairedChecklist({ checkpoint = "active", viewport = 78 }: { checkpoint?: Checkpoint; viewport?: 36 | 78 }) { const entry = checklistFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport); return entry ? <PairedPreview consolePreview={<Native checkpoint={checkpoint} />} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated Checklist frame exists.</p>; }
const meta = { title: "Ovens/Checklist terminal", component: PairedChecklist, args: { checkpoint: "active", viewport: 78 }, argTypes: { checkpoint: { control: "select", options: checklistFixture.checkpoints }, viewport: { control: "select", options: [36, 78] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedChecklist>;
export default meta; export const Paired: StoryObj<typeof meta> = {};
