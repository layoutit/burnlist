import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentMediaPng } from "../../../../tui/src/catalog/component-media-fixture";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/VisualParity/visual-parity.css";
import { ImageTriptych } from "./ImageTriptych";

const fixture = componentPairFixture.visualParityMedia;
const images = fixture.images.map((image) => ({ label: image.label, src: componentMediaPng[image.source], width: image.width, height: image.height }));
const meta = { title: "Patterns/VisualParityMedia", component: ImageTriptych, parameters: { layout: "fullscreen", terminalParityOwner: "oven:visual-parity" } } satisfies Meta<typeof ImageTriptych>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <PairPreview component="visual-parity-media"><ImageTriptych images={[...images]} label={fixture.label} frame={fixture.frame} /></PairPreview>,
};
