import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldDescription, FieldLabel } from "../Field";
import { Textarea } from "./Textarea";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: { placeholder: "Describe the measurable outcome and required evidence." },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Objective = {
  render: (args) => (
    <Field className="storybook-control-demo">
      <FieldLabel htmlFor="textarea-objective">Objective</FieldLabel>
      <Textarea {...args} id="textarea-objective" />
      <FieldDescription>Markdown is supported.</FieldDescription>
    </Field>
  ),
} satisfies Story;

export const Disabled = {
  args: { disabled: true, defaultValue: "This retained objective cannot be edited." },
  render: (args) => (
    <Field className="storybook-control-demo">
      <FieldLabel htmlFor="textarea-disabled">Retained objective</FieldLabel>
      <Textarea {...args} id="textarea-disabled" />
    </Field>
  ),
} satisfies Story;
