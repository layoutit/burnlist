import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeedList } from "../oven/FeedList";
import { PairedPreview, TerminalFrame, streamingFeedFrameEntries } from "../components/TerminalFrame/TerminalFrame";
import { streamingDiffFixture } from "../../../tui/src/catalog/streaming-diff-fixture";

function PairedFeedSurface({ checkpoint = "normal", viewport = 78 }: { checkpoint?: "normal" | "loading" | "error" | "empty"; viewport?: 34 | 78 }) {
  const entry = streamingFeedFrameEntries.find((item) => item.checkpoint === checkpoint && item.viewport.width === viewport), feeds = checkpoint === "normal" ? streamingDiffFixture.payload.feeds : [];
  return entry ? <PairedPreview consolePreview={<FeedList feeds={feeds as never} error={checkpoint === "error" ? "Feed unavailable." : ""} loading={checkpoint === "loading"} showRepository />} terminalPreview={<TerminalFrame entry={entry} />} /> : <p role="status">No generated Streaming Diff feed frame exists.</p>;
}
const meta = { title: "Ovens/Streaming Diff feed terminal", component: PairedFeedSurface, args: { checkpoint: "normal", viewport: 78 }, argTypes: { checkpoint: { control: "select", options: ["normal", "loading", "error", "empty"] }, viewport: { control: "select", options: [34, 78] } }, parameters: { layout: "centered", terminalParityOwner: "terminal-frame" } } satisfies Meta<typeof PairedFeedSurface>;
export default meta;
export const Paired: StoryObj<typeof meta> = {};
