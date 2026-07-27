import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Field, FieldDescription, FieldLabel } from "../Field";
import { Textarea } from "./Textarea";

const fixture = componentPairFixture.textarea;
const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: { label: fixture.label, value: fixture.value, placeholder: "Describe the measurable outcome and required evidence.", disabled: false },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Objective = {
  render: (args) => (
    <PairPreview component="textarea" terminalArgs={args}>
      <Field className="storybook-control-demo">
        <FieldLabel htmlFor="textarea-objective">{String(args.label)}</FieldLabel>
        <Textarea disabled={Boolean(args.disabled)} id="textarea-objective" placeholder={String(args.placeholder)} readOnly value={String(args.value)} />
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
