import { Info } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip";

const meta = {
  title: "UI/Tooltip",
  component: TooltipContent,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TooltipContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
  render: () => (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label="About canonical state" size="icon" variant="outline"><Info aria-hidden="true" /></Button>
        </TooltipTrigger>
        <TooltipContent>Canonical state is the source used to derive this dashboard view.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
} satisfies Story;
