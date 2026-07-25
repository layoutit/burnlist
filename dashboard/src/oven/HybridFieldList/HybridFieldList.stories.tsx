import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { DIFFERENTIAL_STORY_FIELDS } from "../storybook-differential-fixture";
import { HybridFieldList } from "./HybridFieldList";

const fixture = componentPairFixture.fieldListCards;
const pairFields = fixture.fields.map((field) => ({
  id: field.id,
  label: field.label,
  trustStatus: "pass",
  failedSampleCount: field.failures,
  missingSampleCount: 0,
  maxDelta: field.delta,
  samples: [[0, 0, 0, 0], [1, 1, 1 + field.delta, field.failures]],
}));
const meta = {
  title: "Patterns/FieldListCards",
  component: HybridFieldList,
  parameters: { layout: "fullscreen", terminalParityOwner: "oven:differential-testing" },
} satisfies Meta<typeof HybridFieldList>;

export default meta;
type Story = StoryObj<typeof meta>;

function FieldListPreview({
  chartMode,
  fields = DIFFERENTIAL_STORY_FIELDS,
}: {
  chartMode: "delta" | "value";
  fields?: typeof DIFFERENTIAL_STORY_FIELDS | typeof pairFields;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return <div className="shell driving-parity-view storybook-oven-pattern storybook-field-list-pattern">
    <HybridFieldList
      fields={fields}
      expanded={expanded}
      onToggle={toggle}
      chartMode={chartMode}
    />
  </div>;
}

export const Delta: Story = {
  render: () => <PairPreview component="field-list-cards"><FieldListPreview chartMode="delta" fields={pairFields} /></PairPreview>,
};

export const Value: Story = {
  render: () => <FieldListPreview chartMode="value" />,
};
