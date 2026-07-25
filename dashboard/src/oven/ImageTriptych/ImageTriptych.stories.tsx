import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentMediaImages, type ComponentMediaImage } from "../../../../tui/src/catalog/component-media-fixture";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/VisualParity/visual-parity.css";
import { ImageTriptych } from "./ImageTriptych";

const fixture = componentPairFixture.visualParityMedia;
const images = componentMediaImages.map((image) => ({ ...image }));
const meta = {
  title: "Patterns/VisualParityMedia",
  component: ImageTriptych,
  args: { label: fixture.label, frame: fixture.frame, images },
  parameters: { layout: "fullscreen", terminalParityOwner: "oven:visual-parity" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const liveImages = Array.isArray(args.images) ? args.images as ComponentMediaImage[] : images;
    return <PairPreview component="visual-parity-media" terminalArgs={{ ...args, images: liveImages }}>
      <ImageTriptych images={liveImages.map((image) => ({ ...image }))} label={String(args.label)} frame={Number(args.frame)} />
    </PairPreview>;
  },
};
