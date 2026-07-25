import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Input } from "../Input";
import { Select } from "../Select";
import { Textarea } from "../Textarea";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./Field";

const fixture = componentPairFixture.field;
const meta = {
  title: "UI/Field",
  component: Field,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FormComposition = {
  render: () => (
    <PairPreview component="field">
      <FieldGroup className="storybook-form-demo">
        <Field>
          <FieldLabel htmlFor="field-name">Oven name</FieldLabel>
          <Input id="field-name" placeholder="Release readiness" />
          <FieldDescription>A short label shown in the dashboard.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="field-lifecycle">Lifecycle</FieldLabel>
          <Select defaultValue="active" id="field-lifecycle">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="complete">Complete</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="field-objective">Objective</FieldLabel>
          <Textarea id="field-objective" placeholder="Describe the measurable outcome." />
        </Field>
        <Field>
          <FieldLabel htmlFor="field-invalid">{fixture.label}</FieldLabel>
          <Input aria-describedby="field-invalid-error" aria-invalid="true" defaultValue={fixture.value} id="field-invalid" />
          <FieldDescription>{fixture.detail}</FieldDescription>
          <FieldError id="field-invalid-error">{fixture.error}</FieldError>
        </Field>
      </FieldGroup>
    </PairPreview>
  ),
} satisfies Story;
