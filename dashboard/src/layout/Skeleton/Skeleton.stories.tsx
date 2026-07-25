import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Card, CardContent, CardHeader } from "../Card";
import { Skeleton } from "./Skeleton";

const fixture = componentPairFixture.skeleton;
const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardLoading = {
  render: () => (
    <PairPreview component="skeleton">
      <Card aria-label={fixture.label} aria-busy="true" className="storybook-card-demo" role="status">
        <CardHeader>
          <Skeleton className="storybook-skeleton-title" />
          <Skeleton className="storybook-skeleton-copy" />
        </CardHeader>
        <CardContent className="storybook-stack">
          {fixture.rows.map((row) => <Skeleton className="storybook-skeleton-row" key={row} style={{ width: row * 8 }} />)}
        </CardContent>
      </Card>
    </PairPreview>
  ),
} satisfies Story;
