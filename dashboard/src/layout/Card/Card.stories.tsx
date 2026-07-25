import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, Button } from "@layout";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

const fixture = componentPairFixture.card;
const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OvenSummary = {
  render: () => (
    <PairPreview component="card">
      <Card className="storybook-card-demo">
        <CardHeader>
          <CardTitle>{fixture.title}</CardTitle>
          <CardDescription>{fixture.detail}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="storybook-card-copy">{fixture.meta}</p>
        </CardContent>
        <CardFooter className="storybook-card-footer">
          <Badge>ready</Badge>
          <Button size="sm" variant="outline">Open Oven</Button>
        </CardFooter>
      </Card>
    </PairPreview>
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
