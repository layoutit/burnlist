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
  samples: field.samples.map((sample) => [...sample] as [number, number, number, number]),
}));
const meta = {
  title: "Patterns/FieldListCards",
  component: HybridFieldList,
  args: { chartMode: "delta", fields: pairFields },
  argTypes: { chartMode: { control: "inline-radio", options: ["delta", "value"] } },
  parameters: { layout: "fullscreen", terminalParityOwner: "oven:differential-testing" },
} satisfies Meta;

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

export const Playground: Story = {
  render: (args) => {
    const fields = Array.isArray(args.fields) ? args.fields as typeof pairFields : pairFields;
    return <PairPreview component="field-list-cards" terminalArgs={{ ...args, fields }}><FieldListPreview chartMode={String(args.chartMode) as "delta" | "value"} fields={fields} /></PairPreview>;
  },
};

export const Value: Story = {
  render: () => <FieldListPreview chartMode="value" />,
};
