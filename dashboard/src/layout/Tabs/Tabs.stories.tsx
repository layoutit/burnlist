import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const fixture = componentPairFixture.tabs;
const meta = {
  title: "UI/Tabs",
  component: Tabs,
  args: {
    selected: fixture.selected,
    tabs: fixture.tabs,
    panel: fixture.panel,
    orientation: "horizontal",
  },
  argTypes: {
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function BurnlistTabs({ args, onSelected, selected, variant = "default" }: { args: Record<string, unknown>; onSelected: (value: string) => void; selected: string; variant?: "default" | "line" }) {
  const tabs = Array.isArray(args.tabs) ? args.tabs.map(String) : [...fixture.tabs];
  const tab = (index: number, fallback: string) => tabs[index] ?? fallback;
  return (
    <Tabs className="storybook-tabs-demo" orientation={args.orientation as "horizontal" | "vertical"} value={selected.toLowerCase()} onValueChange={onSelected}>
      <TabsList aria-label="Burnlist lifecycle" variant={variant}>
        <TabsTrigger value="active">{tab(0, "Active")}</TabsTrigger>
        <TabsTrigger value="complete">{tab(1, "Complete")}</TabsTrigger>
        <TabsTrigger value="blocked">{tab(2, "Blocked")}</TabsTrigger>
      </TabsList>
      <TabsContent className="storybook-tabs-panel" value="active"><p>{selected.toLowerCase() === "active" ? String(args.panel) : `${tab(0, "Active")} Burnlists`}</p></TabsContent>
      <TabsContent className="storybook-tabs-panel" value="complete"><p>{selected.toLowerCase() === "complete" ? String(args.panel) : `${tab(1, "Complete")} Burnlists`}</p></TabsContent>
      <TabsContent className="storybook-tabs-panel" value="blocked"><p>{selected.toLowerCase() === "blocked" ? String(args.panel) : `${tab(2, "Blocked")} Burnlists`}</p></TabsContent>
    </Tabs>
  );
}

export const Default = {
  render: (args) => {
    const [selected, setSelected] = useState(String(args.selected));
    useEffect(() => setSelected(String(args.selected)), [args.selected]);
    return <PairPreview component="tabs" terminalArgs={{ ...args, selected }}><BurnlistTabs args={args} onSelected={setSelected} selected={selected} /></PairPreview>;
  },
} satisfies Story;

export const Line = {
  render: (args) => <BurnlistTabs args={args} onSelected={() => {}} selected={String(args.selected)} variant="line" />,
} satisfies Story;
