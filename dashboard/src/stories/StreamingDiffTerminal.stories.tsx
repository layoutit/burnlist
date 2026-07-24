import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiffCard } from "../oven/DiffCard";
import { StreamingDiffHeading } from "../oven/StreamingDiffHeading";
import { PairedPreview, TerminalFrame, streamingDiffFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { streamingDiffFixture } from "../../../tui/src/catalog/streaming-diff-fixture";

function PairedStreamingDiff({ checkpoint = "collapsed", viewport = 78 }: { checkpoint?: "collapsed" | "expanded"; viewport?: 34 | 78 }) {
  const entry = streamingDiffFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport), card = streamingDiffFixture.payload.cards[0]!;
  return entry ? <PairedPreview consolePreview={<div><StreamingDiffHeading backHref="/" session={streamingDiffFixture.payload.identity.session} /><DiffCard card={card} /></div>} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated Streaming Diff frame exists.</p>;
}
const meta = { title: "Ovens/Streaming Diff terminal", component: PairedStreamingDiff, args: { checkpoint: "collapsed", viewport: 78 }, argTypes: { checkpoint: { control: "select", options: streamingDiffFixture.checkpoints }, viewport: { control: "select", options: [34, 78] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedStreamingDiff>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
