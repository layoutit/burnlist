import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldDescription, FieldLabel } from "../Field";
import { Select } from "./Select";

const meta = {
  title: "UI/Select",
  component: Select,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lifecycle = {
  render: () => (
    <Field className="storybook-control-demo">
      <FieldLabel htmlFor="select-lifecycle">Lifecycle</FieldLabel>
      <Select defaultValue="active" id="select-lifecycle">
        <option value="draft">Draft</option>
        <option value="ready">Ready</option>
        <option value="active">Active</option>
        <option value="complete">Complete</option>
      </Select>
      <FieldDescription>Controls which Burnlists are included.</FieldDescription>
    </Field>
  ),
} satisfies Story;

export const Disabled = {
  render: () => (
    <Field className="storybook-control-demo">
      <FieldLabel htmlFor="select-disabled">Repository</FieldLabel>
      <Select disabled id="select-disabled"><option>No repositories found</option></Select>
    </Field>
  ),
} satisfies Story;
