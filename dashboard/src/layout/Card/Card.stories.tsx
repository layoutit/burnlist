import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, Button } from "@layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OvenSummary = {
  render: () => (
    <Card className="storybook-card-demo">
      <CardHeader>
        <CardTitle>Differential Testing</CardTitle>
        <CardDescription>Exact-first comparison against the bound native source.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="storybook-card-copy">12 scenarios retained · latest run completed 4 minutes ago.</p>
      </CardContent>
      <CardFooter className="storybook-card-footer">
        <Badge>ready</Badge>
        <Button size="sm" variant="outline">Open Oven</Button>
      </CardFooter>
    </Card>
  ),
} satisfies Story;

export const ContentOnly = {
  render: () => (
    <Card className="storybook-card-demo">
      <CardContent>
        <p className="storybook-card-copy">Cards can also carry a compact, content-only state.</p>
      </CardContent>
    </Card>
  ),
} satisfies Story;
