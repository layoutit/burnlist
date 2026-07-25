import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Card, CardContent, CardHeader } from "../Card";
import { Skeleton } from "./Skeleton";

const fixture = componentPairFixture.skeleton;
const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  args: { label: fixture.label, rows: fixture.rows },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardLoading = {
  render: (args) => (
    <PairPreview component="skeleton" terminalArgs={args}>
      <Card aria-label={String(args.label)} aria-busy="true" className="storybook-card-demo" role="status">
        <CardHeader>
          <Skeleton className="storybook-skeleton-title" />
          <Skeleton className="storybook-skeleton-copy" />
        </CardHeader>
        <CardContent className="storybook-stack">
          {(Array.isArray(args.rows) ? args.rows : fixture.rows).map((row) => <Skeleton className="storybook-skeleton-row" key={Number(row)} style={{ width: Number(row) * 8 }} />)}
        </CardContent>
      </Card>
    </PairPreview>
  ),
} satisfies Story;
