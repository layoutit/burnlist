import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const fixture = componentPairFixture.tabs;
const meta = {
  title: "UI/Tabs",
  component: Tabs,
  args: {
    defaultValue: "active",
    orientation: "horizontal",
  },
  argTypes: {
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

function BurnlistTabs({ variant = "default" }: { variant?: "default" | "line" }) {
  return (
    <Tabs className="storybook-tabs-demo" defaultValue="active">
      <TabsList aria-label="Burnlist lifecycle" variant={variant}>
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="complete">Complete</TabsTrigger>
        <TabsTrigger value="blocked">Blocked</TabsTrigger>
      </TabsList>
      <TabsContent className="storybook-tabs-panel" value="active">
        <p>{fixture.panel}</p>
      </TabsContent>
      <TabsContent className="storybook-tabs-panel" value="complete">
        <p>Completed Burnlists move out of the active queue.</p>
      </TabsContent>
      <TabsContent className="storybook-tabs-panel" value="blocked">
        <p>Blocked work retains the exact condition that needs attention.</p>
      </TabsContent>
    </Tabs>
  );
}

export const Default = {
  render: () => <PairPreview component="tabs"><BurnlistTabs /></PairPreview>,
} satisfies Story;

export const Line = {
  render: () => <BurnlistTabs variant="line" />,
} satisfies Story;
