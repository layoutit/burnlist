import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Field, FieldDescription, FieldLabel } from "../Field";
import { Textarea } from "./Textarea";

const fixture = componentPairFixture.textarea;
const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: { placeholder: "Describe the measurable outcome and required evidence." },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Objective = {
  args: { defaultValue: fixture.value },
  render: (args) => (
    <PairPreview component="textarea">
      <Field className="storybook-control-demo">
        <FieldLabel htmlFor="textarea-objective">{fixture.label}</FieldLabel>
        <Textarea {...args} id="textarea-objective" />
        <FieldDescription>Markdown is supported.</FieldDescription>
      </Field>
    </PairPreview>
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
