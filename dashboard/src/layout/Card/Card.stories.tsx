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
  args: { title: fixture.title, detail: fixture.detail, meta: fixture.meta, status: "ready", action: "Open Oven" },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OvenSummary = {
  render: (args) => (
    <PairPreview component="card" terminalArgs={args}>
      <Card className="storybook-card-demo">
        <CardHeader>
          <CardTitle>{String(args.title)}</CardTitle>
          <CardDescription>{String(args.detail)}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="storybook-card-copy">{String(args.meta)}</p>
        </CardContent>
        <CardFooter className="storybook-card-footer">
          <Badge>{String(args.status)}</Badge>
          <Button aria-label="Card action" size="sm" variant="outline">{String(args.action)}</Button>
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
