import { Info } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Button } from "../Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip";

const fixture = componentPairFixture.tooltip;
const meta = {
  title: "UI/Tooltip",
  component: TooltipContent,
  args: { label: fixture.label, detail: fixture.detail, open: true },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: (args) => (
    <PairPreview component="tooltip" terminalArgs={args}>
      <TooltipProvider delayDuration={0}>
        <Tooltip open={Boolean(args.open)}>
          <TooltipTrigger asChild>
            <Button aria-label="Tooltip information" size="icon" variant="outline"><Info aria-hidden="true" /></Button>
          </TooltipTrigger>
          <TooltipContent>{String(args.detail)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </PairPreview>
  ),
} satisfies Story;
