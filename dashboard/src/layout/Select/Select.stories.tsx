import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Field, FieldDescription, FieldLabel } from "../Field";
import { Select } from "./Select";

const fixture = componentPairFixture.select;
const meta = {
  title: "UI/Select",
  component: Select,
  args: { label: fixture.label, value: fixture.value, options: fixture.options, disabled: false },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lifecycle = {
  render: (args) => {
    const [selected, setSelected] = useState(String(args.value));
    useEffect(() => setSelected(String(args.value)), [args.value]);
    const options = Array.isArray(args.options) ? args.options.map(String) : [...fixture.options];
    return <PairPreview component="select" terminalArgs={{ ...args, value: selected, options }}>
      <Field className="storybook-control-demo">
        <FieldLabel htmlFor="select-lifecycle">{String(args.label)}</FieldLabel>
        <Select disabled={Boolean(args.disabled)} id="select-lifecycle" value={selected} onChange={(event) => setSelected(event.currentTarget.value)}>
          <option value="draft">{options[0] ?? "draft"}</option>
          <option value="ready">{options[1] ?? "ready"}</option>
          <option value="active">{options[2] ?? "active"}</option>
          <option value="complete">{options[3] ?? "complete"}</option>
        </Select>
        <FieldDescription>Controls which Burnlists are included.</FieldDescription>
      </Field>
    </PairPreview>;
  },
} satisfies Story;

export const Disabled = {
  render: () => (
    <Field className="storybook-control-demo">
      <FieldLabel htmlFor="select-disabled">Repository</FieldLabel>
      <Select disabled id="select-disabled"><option>No repositories found</option></Select>
    </Field>
  ),
} satisfies Story;
