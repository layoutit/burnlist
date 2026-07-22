import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert, AlertDescription, AlertTitle } from "./Alert";

const meta = {
  title: "UI/Alert",
  component: Alert,
  args: { variant: "info" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground = {
  render: (args) => (
    <Alert {...args} className="storybook-alert-demo">
      <Info aria-hidden="true" />
      <AlertTitle>Burn is ready</AlertTitle>
      <AlertDescription>All required evidence is available for review.</AlertDescription>
    </Alert>
  ),
} satisfies Story;

export const Variants = {
  render: () => (
    <div className="storybook-flow">
      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Information</AlertTitle>
        <AlertDescription>The dashboard refreshes automatically when local state changes.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <CheckCircle2 aria-hidden="true" />
        <AlertTitle>Verification passed</AlertTitle>
        <AlertDescription>The run is ready to move to completed.</AlertDescription>
      </Alert>
      <Alert variant="warning">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Evidence is stale</AlertTitle>
        <AlertDescription>Refresh the retained artifacts before accepting this result.</AlertDescription>
      </Alert>
      <Alert variant="destructive" role="alert">
        <XCircle aria-hidden="true" />
        <AlertTitle>Run failed</AlertTitle>
        <AlertDescription>The canonical state could not be read.</AlertDescription>
      </Alert>
    </div>
  ),
} satisfies Story;
