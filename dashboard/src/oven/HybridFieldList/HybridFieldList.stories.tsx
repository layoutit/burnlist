import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import "../../components/DifferentialTesting/differential-testing.css";
import { DIFFERENTIAL_STORY_FIELDS } from "../storybook-differential-fixture";
import { HybridFieldList } from "./HybridFieldList";

const meta = {
  title: "Patterns/FieldListCards",
  component: HybridFieldList,
  parameters: { layout: "fullscreen", terminalParityOwner: "oven:differential-testing" },
} satisfies Meta<typeof HybridFieldList>;

export default meta;
type Story = StoryObj<typeof meta>;

function FieldListPreview({ chartMode }: { chartMode: "delta" | "value" }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return <div className="shell driving-parity-view storybook-oven-pattern storybook-field-list-pattern">
    <HybridFieldList
      fields={DIFFERENTIAL_STORY_FIELDS}
      expanded={expanded}
      onToggle={toggle}
      chartMode={chartMode}
    />
  </div>;
}

export const Delta: Story = {
  render: () => <FieldListPreview chartMode="delta" />,
};

export const Value: Story = {
  render: () => <FieldListPreview chartMode="value" />,
};
