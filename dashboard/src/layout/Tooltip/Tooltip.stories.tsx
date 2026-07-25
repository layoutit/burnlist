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
  parameters: { layout: "centered" },
} satisfies Meta<typeof TooltipContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: () => (
    <PairPreview component="tooltip">
      <TooltipProvider delayDuration={0}>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <Button aria-label={fixture.label} size="icon" variant="outline"><Info aria-hidden="true" /></Button>
          </TooltipTrigger>
          <TooltipContent>{fixture.detail}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </PairPreview>
  ),
} satisfies Story;
