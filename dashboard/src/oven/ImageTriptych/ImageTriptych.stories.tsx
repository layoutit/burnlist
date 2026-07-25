import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentMediaPng } from "../../../../tui/src/catalog/component-media-fixture";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/VisualParity/visual-parity.css";
import { ImageTriptych } from "./ImageTriptych";

const fixture = componentPairFixture.visualParityMedia;
const images = fixture.images.map((image) => ({ label: image.label, src: componentMediaPng[image.source], width: image.width, height: image.height }));
const meta = { title: "Patterns/VisualParityMedia", component: ImageTriptych, args: { label: fixture.label, frame: fixture.frame }, parameters: { layout: "fullscreen", terminalParityOwner: "oven:visual-parity" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <PairPreview component="visual-parity-media" terminalArgs={{ ...args, labels: images.map((image) => image.label) }}><ImageTriptych images={[...images]} label={String(args.label)} frame={Number(args.frame)} /></PairPreview>,
};
