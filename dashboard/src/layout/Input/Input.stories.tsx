import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Field, FieldDescription, FieldLabel } from "../Field";
import { Input } from "./Input";

const fixture = componentPairFixture.input;
const meta = {
  title: "UI/Input",
  component: Input,
  args: { placeholder: "Search Burnlists…" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {
  args: { "aria-label": fixture.label, defaultValue: fixture.value },
  render: (args) => (
    <PairPreview component="input" terminalArgs={{ ...args, label: args["aria-label"], value: args.value ?? args.defaultValue }}>
      <Input {...args} className="storybook-control-demo" />
    </PairPreview>
  ),
} satisfies Story;

export const States = {
  render: () => (
    <div className="storybook-form-demo">
      <Field>
        <FieldLabel htmlFor="input-default">Default</FieldLabel>
        <Input id="input-default" placeholder="Burnlist title" />
      </Field>
      <Field>
        <FieldLabel htmlFor="input-value">With value</FieldLabel>
        <Input defaultValue="Observer layout" id="input-value" />
        <FieldDescription>Values use the dashboard data face.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="input-invalid">Invalid</FieldLabel>
        <Input aria-invalid="true" defaultValue="bad path" id="input-invalid" />
      </Field>
      <Field>
        <FieldLabel htmlFor="input-disabled">Disabled</FieldLabel>
        <Input disabled id="input-disabled" placeholder="Unavailable" />
      </Field>
    </div>
  ),
} satisfies Story;
